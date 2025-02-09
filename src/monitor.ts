// src/monitor.ts

import WebSocket from 'ws';
import fetch from 'node-fetch';
import { NetworkConfig, DepositCallback, DepositEvent, TransactionDetails } from './types';
import { AddressUtils } from './address';
import { Logger, LogLevel, LogOptions } from './logger';

interface BlockResponse {
  block: {
    header: {
      height: string;
    };
  };
}

interface TxResponse {
  tx_responses?: Array<{
    txhash: string;
    height: string;
    gas_used: string;
    gas_wanted: string;
    timestamp: string;
    logs?: Array<{
      msg_index: number;
      log: string;
      events: Array<{
        type: string;
        attributes: Array<{
          key: string;
          value: string;
        }>;
      }>;
    }>;
    events?: Array<{
      type: string;
      attributes: Array<{
        key: string;
        value: string;
      }>;
    }>;
  }>;
}

export interface MonitorConfig extends NetworkConfig {
  logLevel?: LogLevel;
}

export class SeiDepositMonitor {
  private config: MonitorConfig;
  private ws: WebSocket | null = null;
  private callbacks: Set<DepositCallback> = new Set();
  private isMonitoring: boolean = false;
  private reconnectTimeout: NodeJS.Timeout | null = null;
  private targetAddress: string;
  private castAddress: string | null = null;
  private logger: Logger;

  constructor(config: MonitorConfig, targetAddress: string) {
    this.config = {
      ...config,
      wsEndpoint: this.normalizeWsEndpoint(config.wsEndpoint)
    };
    this.targetAddress = targetAddress;

    // Initialize logger
    const logOptions: LogOptions = {
      level: config.logLevel || LogLevel.INFO,
      prefix: 'SeiMonitor',
      timestamp: true
    };
    this.logger = new Logger(logOptions);

    // If the target address is an ETH address, calculate its cast address
    if (AddressUtils.isEthAddress(targetAddress)) {
      this.castAddress = AddressUtils.ethAddressToBech32(targetAddress, config.prefix);
      this.logger.info(`Monitoring cast address: ${this.castAddress}`);
    }
  }

  private normalizeWsEndpoint(endpoint: string): string {
    return endpoint.endsWith('/websocket') ? endpoint : `${endpoint}/websocket`;
  }

  public onDeposit(callback: DepositCallback): void {
    this.callbacks.add(callback);
    this.logger.debug('Added new deposit callback handler');
  }

  public removeCallback(callback: DepositCallback): void {
    this.callbacks.delete(callback);
    this.logger.debug('Removed deposit callback handler');
  }

  private async notifyCallbacks(event: DepositEvent): Promise<void> {
    this.logger.debug('Notifying callbacks of new deposit event', event);
    for (const callback of this.callbacks) {
      try {
        await callback(event);
      } catch (error) {
        this.logger.error('Error in deposit callback:', error);
      }
    }
  }

  /**
   * Parses transaction logs to find any deposits to `this.targetAddress` or `this.castAddress`.
   * Returns an array because a single Tx can deposit to your address multiple times.
   */
  private parseTransactionDetails(tx: any): TransactionDetails[] {
    this.logger.trace('Parsing transaction details', tx);

    const depositDetails: TransactionDetails[] = [];

    // If this is from REST, we usually see logs at tx.logs.
    // If from WS (Tendermint), sometimes we see them under tx.result.events, etc.
    // We'll unify by first checking tx.logs if available:
    const logs = tx.logs || [];
    // If no logs, try to see if we have direct events from the WS shape:
    if (!logs.length && tx.result?.events) {
      // We'll simulate a single log with these events
      logs.push({
        msg_index: 0,
        log: '',
        events: tx.result.events
      });
    }

    for (const log of logs) {
      const events = log.events || [];
      // We also want to figure out which action was used in this message.
      // Usually found in a "message" event => attribute key = "action"
      let actionType = 'unknown';
      const messageEvent = events.find((e: { type: string; }) => e.type === 'message');
      if (messageEvent && messageEvent.attributes) {
        const actionAttr = messageEvent.attributes.find((a: { key: string; }) => a.key === 'action');
        if (actionAttr) {
          actionType = actionAttr.value;
        }
      }

      // Look for coin_received events
      const coinReceivedEvents = events.filter((e: { type: string; }) => e.type === 'coin_received');
      for (const cre of coinReceivedEvents) {
        const attrs = cre.attributes || [];
        // A single coin_received can have multiple (receiver, amount) pairs in one array
        // Example:
        // [
        //   { key: 'receiver', value: 'sei1abc...' },
        //   { key: 'amount',   value: '100000usei' },
        //   { key: 'receiver', value: 'sei1xyz...' },
        //   { key: 'amount',   value: '23usei' },
        // ]
        for (let i = 0; i < attrs.length; i += 2) {
          const receiverAttr = attrs[i];
          const amountAttr = attrs[i + 1];
          if (!receiverAttr || !amountAttr) continue;
          if (receiverAttr.key !== 'receiver' || amountAttr.key !== 'amount') continue;

          const receiver = receiverAttr.value;
          const amount = amountAttr.value;
          // Check if this deposit is for our target or cast address
          if (receiver === this.targetAddress || receiver === this.castAddress) {
            const detail: TransactionDetails = {
              hash: tx.txhash || tx.hash,
              height: tx.height,
              type: actionType, // We'll store the raw "action" here
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

    this.logger.trace('Parsed deposit details', depositDetails);
    return depositDetails;
  }

  /**
   * Helper to find a "sender" in the events.
   */
  private extractSender(events: Array<{ type: string; attributes: Array<{ key: string; value: string }> }>): string | undefined {
    // First try the "message" event
    const messageEvent = events.find((e) => e.type === 'message');
    if (messageEvent) {
      const senderAttr = messageEvent.attributes.find((a) => a.key === 'sender');
      if (senderAttr) return senderAttr.value;
    }
    // If not found, maybe it's in "transfer"
    const transferEvent = events.find((e) => e.type === 'transfer');
    if (transferEvent) {
      const senderAttr = transferEvent.attributes.find((a) => a.key === 'sender');
      if (senderAttr) return senderAttr.value;
    }
    return undefined;
  }

  /**
   * Determines whether a parsed deposit is 'direct', 'evm', or 'cast'.
   */
  private determineDepositType(details: TransactionDetails): 'direct' | 'evm' | 'cast' {
    // If deposit is going to the cast address, treat as 'cast'
    if (details.receiver === this.castAddress) {
      this.logger.debug('Identified cast address deposit', { receiver: details.receiver });
      return 'cast';
    }
    // If the action is EVM
    if (details.type === '/seiprotocol.seichain.evm.MsgEVMTransaction') {
      this.logger.debug('Identified EVM transaction', { type: details.type });
      return 'evm';
    }
    // Otherwise default to direct
    this.logger.debug('Identified direct deposit', { type: details.type });
    return 'direct';
  }

  public async start(): Promise<void> {
    if (this.isMonitoring) {
      this.logger.warn('Monitor already running');
      return;
    }

    this.isMonitoring = true;
    this.logger.info('Starting deposit monitor');

    // Start both WebSocket and REST monitoring for comprehensive coverage
    await this.startWebSocket();
    this.startRestPolling();
  }

  private async startWebSocket(): Promise<void> {
    try {
      this.logger.debug(`Connecting to WebSocket endpoint: ${this.config.wsEndpoint}`);
      this.ws = new WebSocket(this.config.wsEndpoint);

      this.ws.on('open', () => {
        this.logger.info('WebSocket connected successfully');
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
          this.logger.debug('Sent subscription request', subscription);
        }
      });

      this.ws.on('message', async (data: WebSocket.Data) => {
        try {
          const response = JSON.parse(data.toString());
          this.logger.trace('Received WebSocket message', response);

          // Check if there's a TxResult
          if (response.result?.data?.value?.TxResult) {
            const txResult = response.result.data.value.TxResult;
            this.logger.debug('Processing transaction result', txResult);

            // parseTransactionDetails returns an array
            const depositDetails = this.parseTransactionDetails(txResult);
            if (depositDetails.length) {
              for (const details of depositDetails) {
                const event: DepositEvent = {
                  type: this.determineDepositType(details),
                  transaction: details
                };
                this.logger.info('New deposit detected (WS)', event);
                await this.notifyCallbacks(event);
              }
            }
          }
        } catch (error) {
          this.logger.error('Error processing WebSocket message:', error);
        }
      });

      this.ws.on('error', (error: Error) => {
        this.logger.error('WebSocket error:', error);
        this.reconnect();
      });

      this.ws.on('close', () => {
        this.logger.warn('WebSocket connection closed, attempting to reconnect...');
        this.reconnect();
      });
    } catch (error) {
      this.logger.error('Error setting up WebSocket:', error);
      this.reconnect();
    }
  }

  private reconnect(): void {
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
    }

    this.reconnectTimeout = setTimeout(() => {
      if (this.isMonitoring) {
        this.logger.info('Attempting to reconnect WebSocket');
        this.startWebSocket();
      }
    }, 5000);
  }

  private async startRestPolling(): Promise<void> {
    this.logger.info('Starting REST polling');
    let lastCheckedBlock = await this.getLatestBlockHeight();
    this.logger.debug('Initial block height', { height: lastCheckedBlock });

    const poll = async () => {
      if (!this.isMonitoring) return;

      try {
        const currentHeight = await this.getLatestBlockHeight();
        this.logger.trace('Polling block height', { current: currentHeight, last: lastCheckedBlock });

        if (currentHeight > lastCheckedBlock) {
          this.logger.debug('New blocks detected', {
            from: lastCheckedBlock + 1,
            to: currentHeight
          });

          const transactions = await this.getTransactions(lastCheckedBlock + 1, currentHeight);
          this.logger.debug(`Found ${transactions.length} transactions`);

          for (const tx of transactions) {
            // parseTransactionDetails returns an array
            const depositDetails = this.parseTransactionDetails(tx);
            if (depositDetails.length) {
              for (const details of depositDetails) {
                const event: DepositEvent = {
                  type: this.determineDepositType(details),
                  transaction: details
                };
                this.logger.info('New deposit detected via REST', event);
                await this.notifyCallbacks(event);
              }
            }
          }

          lastCheckedBlock = currentHeight;
        }
      } catch (error) {
        this.logger.error('Error in REST polling:', error);
      }

      setTimeout(poll, 6000);
    };

    poll();
  }

  private async getLatestBlockHeight(): Promise<number> {
    const response = await fetch(`${this.config.restEndpoint}/blocks/latest`);
    const data = (await response.json()) as BlockResponse;
    return parseInt(data.block.header.height);
  }

  private async getTransactions(fromBlock: number, toBlock: number): Promise<any[]> {
    // We look for coin_received.receiver = your target or cast address.
    // Adjust if your chain uses 'transfer.recipient' or anything else.
    const query = `coin_received.receiver='${this.targetAddress}'${this.castAddress ? ` OR coin_received.receiver='${this.castAddress}'` : ''}`;
    const url = `${this.config.restEndpoint}/cosmos/tx/v1beta1/txs?events=${encodeURIComponent(query)}&pagination.limit=100`;

    this.logger.debug('Fetching transactions', { url, fromBlock, toBlock });

    const response = await fetch(url);
    const data = (await response.json()) as TxResponse;
    return data.tx_responses || [];
  }

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
}
