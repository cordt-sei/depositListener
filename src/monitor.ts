// src/monitor.ts

import WebSocket from 'ws';
import fetch from 'node-fetch';
import {
    MonitorConfig,
    DepositCallback,
    DepositEvent,
    TransactionDetails,
    JsonRpcResponse
  } from './types';
import { AddressUtils } from './address';
import { Logger, LogLevel, LogOptions } from './logger';

/**
 * The shape of the block/latest response
 */
interface BlockResponse {
  block: {
    header: {
      height: string;
    };
  };
}

/**
 * Log events from the chain's transaction logs
 */
interface TxLogEvent {
  type: string;
  attributes: Array<{ key: string; value: string }>;
}

interface TxLog {
  msg_index: number;
  log: string;
  events: TxLogEvent[];
}

/**
 * A single transaction response item from the REST or WS
 */
interface TxResponseItem {
  txhash: string;
  height: string;
  gas_used: string;
  gas_wanted: string;
  timestamp: string;
  logs?: TxLog[];
  events?: TxLogEvent[];
  /**
   * Some WS data includes a `result` object with `events`; we handle it carefully.
   */
  result?: {
    events?: TxLogEvent[];
  };
}

/**
 * The shape of the /txs?events= response
 */
interface TxResponse {
  tx_responses?: TxResponseItem[];
}

/**
 * associated wallet lookup - wallets.sei.basementnodes.ca/<0x> response
 */
interface WalletsLookup {
  original: string;
  result: string;
}

/**
 * The main deposit monitor class.
 *
 * This class monitors for incoming deposits to a given address (bech32 or hex).
 * - If given a bech32 address, it monitors directly for `coin_received.receiver = address`.
 * - If given a hex address (0x):
 *    1) Checks if it's a smart contract => cast to bech32
 *    2) If it's an EOA with no transactions => “cast address” until first TX
 *    3) If the chain knows the final bech32 => use that
 */
export class SeiDepositMonitor {
  private config: MonitorConfig;
  private ws: WebSocket | null = null;
  private callbacks: Set<DepositCallback> = new Set();
  private isMonitoring: boolean = false;
  private reconnectTimeout: NodeJS.Timeout | null = null;
  private logger: Logger;

  // original address (bech32 or 0x)
  private targetAddress: string;

  // final address wanted in coin_received => always bech32
  private finalAddress: string;

  constructor(config: MonitorConfig, targetAddress: string) {
    // normalize the WebSocket endpoint
    this.config = {
      ...config,
      wsEndpoint: this.normalizeWsEndpoint(config.wsEndpoint)
    };
    this.targetAddress = targetAddress;
    this.finalAddress = targetAddress; // will be overridden if 0x

    // Setup logger
    const level = config.logLevel ?? LogLevel.INFO;
    const logOptions: LogOptions = {
      level,
      prefix: 'SeiMonitor',
      timestamp: true
    };
    this.logger = new Logger(logOptions);
  }

  private normalizeWsEndpoint(endpoint: string): string {
    return endpoint.endsWith('/websocket') ? endpoint : `${endpoint}/websocket`;
  }

  /**
   * Add a callback to be notified on new deposits
   */
  public onDeposit(callback: DepositCallback): void {
    this.callbacks.add(callback);
    this.logger.debug('Added new deposit callback handler');
  }

  /**
   * Remove a previously registered callback
   */
  public removeCallback(callback: DepositCallback): void {
    this.callbacks.delete(callback);
    this.logger.debug('Removed deposit callback handler');
  }

  /**
   * Notify all callbacks about a deposit
   */
  private async notifyCallbacks(event: DepositEvent): Promise<void> {
    this.logger.debug('Notifying callbacks of new deposit event', event);
    for (const cb of this.callbacks) {
      try {
        await cb(event);
      } catch (error) {
        this.logger.error('Error in deposit callback:', error);
      }
    }
  }

  /**
   * start monitoring
   * - If targetAddress is 0x, we resolve it (contract => cast, EOA => possible cast, known wallet => use final).
   * - Then we open WS and REST polling to detect deposits.
   */
  public async start(): Promise<void> {
    if (this.isMonitoring) {
      this.logger.warn('Monitor already running');
      return;
    }

    // for hex address, we may want to resolve
    if (AddressUtils.isEthAddress(this.targetAddress)) {
      this.logger.info(`Address ${this.targetAddress} is EVM. Resolving...`);
      this.finalAddress = await this.resolveEvmAddress(this.targetAddress);
      this.logger.info(`Resolved => final address = ${this.finalAddress}`);
    } else {
      this.logger.info(`Using direct bech32 address => ${this.finalAddress}`);
    }

    this.isMonitoring = true;
    this.logger.info('Starting deposit monitor...');

    await this.startWebSocket();
    this.startRestPolling();
  }

  /**
   * Stop the monitor gracefully
   */
  public stop(): void {
    this.logger.info('Stopping deposit monitor');
    this.isMonitoring = false;
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }
    this.logger.debug('Monitor stopped successfully');
  }

  // -----------------------------------------------
  //   EVM Address Resolution (contract vs. EOA)
  // -----------------------------------------------
  private async resolveEvmAddress(hexAddr: string): Promise<string> {
    const evmRpc = this.config.evmRpcEndpoint || 'https://evm-rpc.sei.basementnodes.ca';
    this.logger.debug(`resolveEvmAddress => Checking code at ${hexAddr}`);
    const code = await this.ethGetCode(evmRpc, hexAddr);

    // if code != '0x', it’s a contract => cast
    if (code && code !== '0x') {
      this.logger.debug('Detected contract => cast to bech32');
      return AddressUtils.ethAddressToBech32(hexAddr, this.config.prefix);
    }

    // else EOA => check transaction count
    const txCountHex = await this.ethGetTransactionCount(evmRpc, hexAddr);
    const txCount = parseInt(txCountHex, 16) || 0;
    this.logger.debug(`EOA => txCount = ${txCount}`);

    // ifinal wallet known, use that
    const chainWallet = await this.lookupChainWallet(hexAddr);
    if (chainWallet) {
      // known final address
      this.logger.debug(`Chain wallet found => ${chainWallet}`);
      return chainWallet;
    }

    // if new EOA => cast until first tx signed
    if (txCount === 0) {
      this.logger.warn('EOA brand-new => casting address');
      return AddressUtils.ethAddressToBech32(hexAddr, this.config.prefix);
    }

    // has txCount but no chain mapping => fallback to cast or error
    this.logger.warn('EOA has tx but no chain mapping => fallback cast');
    return AddressUtils.ethAddressToBech32(hexAddr, this.config.prefix);
  }

  private async ethGetCode(rpc: string, address: string): Promise<string | null> {
    try {
      const body = {
        jsonrpc: '2.0',
        id: 1,
        method: 'eth_getCode',
        params: [address, 'latest']
      };
      const resp = await fetch(rpc, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
  
      // Use our newly-defined JSON-RPC response type
      const data = (await resp.json()) as JsonRpcResponse<string>;
  
      // Optional: handle RPC errors
      if (data.error) {
        this.logger.error(`eth_getCode error: ${data.error.message}`, data.error);
        return null;
      }
  
      // If no error, return the 'result' (e.g. "0x" or "0x6080...")
      return data.result || null;
    } catch (error) {
      this.logger.error('eth_getCode failed', error);
      return null;
    }
  }
  
  private async ethGetTransactionCount(rpc: string, address: string): Promise<string> {
    try {
      const body = {
        jsonrpc: '2.0',
        id: 1,
        method: 'eth_getTransactionCount',
        params: [address, 'latest']
      };
      const resp = await fetch(rpc, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
  
      const data = (await resp.json()) as JsonRpcResponse<string>;
  
      if (data.error) {
        this.logger.error(`eth_getTransactionCount error: ${data.error.message}`, data.error);
        // fallback to '0x0' if there's an error
        return '0x0';
      }
  
      return data.result || '0x0';
    } catch (error) {
      this.logger.error('eth_getTransactionCount failed', error);
      return '0x0';
    }
  }
  
  /**
   * Looks up the final chain wallet from the wallets.sei.basementnodes.ca service
   */
  private async lookupChainWallet(hexAddr: string): Promise<string | null> {
    try {
      const url = `https://wallets.sei.basementnodes.ca/${hexAddr}`;
      this.logger.debug(`lookupChainWallet => ${url}`);
      const resp = await fetch(url);
      if (!resp.ok) {
        return null;
      }
      const data = (await resp.json()) as WalletsLookup;
      return data.result || null;
    } catch (error) {
      this.logger.error('lookupChainWallet failed', error);
      return null;
    }
  }

  // ------------------------------------------
  //     WebSocket Monitoring
  // ------------------------------------------
  private async startWebSocket(): Promise<void> {
    try {
      this.logger.debug(`Connecting to WS => ${this.config.wsEndpoint}`);
      this.ws = new WebSocket(this.config.wsEndpoint);

      this.ws.on('open', () => {
        this.logger.info('WebSocket connected');
        const subscription = {
          jsonrpc: '2.0',
          method: 'subscribe',
          id: 1,
          params: {
            query: "tm.event='Tx'"
          }
        };
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
          this.ws.send(JSON.stringify(subscription));
          this.logger.debug('Sent subscribe request', subscription);
        }
      });

      this.ws.on('message', async (data: WebSocket.Data) => {
        try {
          const response = JSON.parse(data.toString());
          this.logger.trace('WS message', response);

          // cast response to any so TS doesn't complain about .result
          const maybeTxResult = (response as any)?.result?.data?.value?.TxResult;
          if (maybeTxResult) {
            this.logger.debug('WS TxResult =>', maybeTxResult);
            const depositDetails = this.parseTransactionDetails(maybeTxResult);
            if (depositDetails.length) {
              for (const detail of depositDetails) {
                const event: DepositEvent = {
                  type: this.determineDepositType(detail),
                  transaction: detail
                };
                this.logger.info('New deposit (WS)', event);
                await this.notifyCallbacks(event);
              }
            }
          }
        } catch (err) {
          this.logger.error('Error processing WS message:', err);
        }
      });

      this.ws.on('error', (err: Error) => {
        this.logger.error('WebSocket error:', err);
        this.reconnect();
      });

      this.ws.on('close', () => {
        this.logger.warn('WebSocket closed, reconnecting...');
        this.reconnect();
      });
    } catch (error) {
      this.logger.error('startWebSocket error:', error);
      this.reconnect();
    }
  }

  private reconnect(): void {
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
    }
    this.reconnectTimeout = setTimeout(() => {
      if (this.isMonitoring) {
        this.logger.info('Reconnecting WebSocket...');
        this.startWebSocket();
      }
    }, 5000);
  }

  // ------------------------------------------
  //     REST Polling Fallback
  // ------------------------------------------
  private async startRestPolling(): Promise<void> {
    this.logger.info('Starting REST polling...');
    let lastCheckedBlock = await this.getLatestBlockHeight();
    this.logger.debug('Initial block height =>', lastCheckedBlock);

    const poll = async () => {
      if (!this.isMonitoring) return;

      try {
        const currentHeight = await this.getLatestBlockHeight();
        this.logger.trace('Polling block height =>', { current: currentHeight, last: lastCheckedBlock });

        if (currentHeight > lastCheckedBlock) {
          this.logger.debug('New blocks detected =>', { from: lastCheckedBlock + 1, to: currentHeight });

          const txs = await this.getTransactions(lastCheckedBlock + 1, currentHeight);
          this.logger.debug(`Fetched ${txs.length} transaction(s)`);
          for (const tx of txs) {
            const depositDetails = this.parseTransactionDetails(tx);
            if (depositDetails.length) {
              for (const detail of depositDetails) {
                const event: DepositEvent = {
                  type: this.determineDepositType(detail),
                  transaction: detail
                };
                this.logger.info('New deposit (REST)', event);
                await this.notifyCallbacks(event);
              }
            }
          }
          lastCheckedBlock = currentHeight;
        }
      } catch (err) {
        this.logger.error('REST polling error:', err);
      }
      setTimeout(poll, 6000);
    };

    poll();
  }

  private async getLatestBlockHeight(): Promise<number> {
    const url = `${this.config.restEndpoint}/blocks/latest`;
    const resp = await fetch(url);
    const data = (await resp.json()) as BlockResponse;
    return parseInt(data.block.header.height, 10);
  }

  private async getTransactions(fromBlock: number, toBlock: number): Promise<TxResponseItem[]> {
    // watch coin_received.receiver = finalAddress
    const query = `coin_received.receiver='${this.finalAddress}'`;
    const url = `${this.config.restEndpoint}/cosmos/tx/v1beta1/txs?events=${encodeURIComponent(query)}&pagination.limit=100`;
    this.logger.debug('getTransactions =>', { fromBlock, toBlock, url });
    const resp = await fetch(url);
    const data = (await resp.json()) as TxResponse;
    return data.tx_responses || [];
  }

 // ------------------------------------------
//     Parsing transaction logs
// ------------------------------------------
private parseTransactionDetails(tx: TxResponseItem): TransactionDetails[] {
    this.logger.trace('parseTransactionDetails =>', tx);
    const depositDetails: TransactionDetails[] = [];
  
    // Start with whatever logs we might have from REST
    let logs = tx.logs || [];
  
    /**
     * If logs is empty, check for:
     * - top-level `tx.events` (the shape your test uses),
     * - WS-based `tx.result?.events`.
     */
    if (!logs.length) {
      if (tx.events?.length) {
        logs = [
          {
            msg_index: 0,
            log: '',
            events: tx.events
          }
        ];
      } else if (tx.result?.events?.length) {
        logs = [
          {
            msg_index: 0,
            log: '',
            events: tx.result.events
          }
        ];
      }
    }
  
    // Now `logs` may have at least one entry if events exist
    for (const log of logs) {
      const events = log.events || [];
  
      // Identify the message type => e.g. '/cosmos.bank.v1beta1.MsgSend' or '/seiprotocol.seichain.evm.MsgEVMTransaction'
      let actionType = 'unknown';
      const messageEvent = events.find((e) => e.type === 'message');
      if (messageEvent) {
        const actionAttr = messageEvent.attributes.find((a) => a.key === 'action');
        if (actionAttr) {
          actionType = actionAttr.value;
        }
      }
  
      // Look for coin_received events
      const coinReceivedEvents = events.filter((e) => e.type === 'coin_received');
      for (const cre of coinReceivedEvents) {
        const attrs = cre.attributes || [];
        // Each coin_received can have multiple (receiver, amount) pairs
        for (let i = 0; i < attrs.length; i += 2) {
          const receiverAttr = attrs[i];
          const amountAttr = attrs[i + 1];
          if (!receiverAttr || !amountAttr) continue;
          if (receiverAttr.key !== 'receiver' || amountAttr.key !== 'amount') continue;
  
          const receiver = receiverAttr.value;
          const amount = amountAttr.value;
  
          // If this matches our finalAddress, it's a deposit
          if (receiver === this.finalAddress) {
            const detail: TransactionDetails = {
              hash: tx.txhash,
              height: tx.height,
              type: actionType,
              amount,
              receiver,
              sender: this.extractSender(events),
              gasUsed: tx.gas_used,
              gasWanted: tx.gas_wanted,
              timestamp: tx.timestamp,
              raw: tx
            };
            depositDetails.push(detail);
          }
        }
      }
    }
  
    return depositDetails;
  }
  
  /**
   * Helper to extract 'sender' from events (via 'message' or 'transfer').
   */
  private extractSender(events: TxLogEvent[]): string | undefined {
    const msgEvent = events.find((e) => e.type === 'message');
    if (msgEvent) {
      const senderAttr = msgEvent.attributes.find((a) => a.key === 'sender');
      if (senderAttr) return senderAttr.value;
    }
  
    const transferEvent = events.find((e) => e.type === 'transfer');
    if (transferEvent) {
      const senderAttr = transferEvent.attributes.find((a) => a.key === 'sender');
      if (senderAttr) return senderAttr.value;
    }
  
    return undefined;
  }
  
  /**
   * Determine deposit type: 'evm', 'direct', or 'cast'
   *
   * - EVM: if action is '/seiprotocol.seichain.evm.MsgEVMTransaction'
   * - direct: normal bank send
   * - cast: If you specifically want to identify a “cast address” deposit
   *   (maybe by comparing to a known cast address or logic),
   *   you could implement that check here.
   */
  private determineDepositType(details: TransactionDetails): 'direct' | 'evm' | 'cast' {
    if (details.type === '/seiprotocol.seichain.evm.MsgEVMTransaction') {
      this.logger.debug('EVM deposit identified');
      return 'evm';
    }
    // If you have logic to detect a brand-new EOA deposit, you could do so:
    // if (details.receiver === this.castAddress) { return 'cast'; }

    this.logger.debug('Direct deposit identified');
    return 'direct';
  }
}
