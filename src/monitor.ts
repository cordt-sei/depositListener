// src/monitor.ts
import WebSocket from 'ws';
import fetch from 'node-fetch';
import { NetworkConfig, DepositCallback, DepositEvent, TransactionDetails } from './types';
import { AddressUtils } from './address';

export class SeiDepositMonitor {
    private config: NetworkConfig;
    private ws: WebSocket | null = null;
    private callbacks: Set<DepositCallback> = new Set();
    private isMonitoring: boolean = false;
    private reconnectTimeout: NodeJS.Timeout | null = null;
    private targetAddress: string;
    private castAddress: string | null = null;

    constructor(config: NetworkConfig, targetAddress: string) {
        this.config = config;
        this.targetAddress = targetAddress;

        // If the target address is an ETH address, calculate its cast address
        if (AddressUtils.isEthAddress(targetAddress)) {
            this.castAddress = AddressUtils.ethAddressToBech32(targetAddress, config.prefix);
            console.log(`Monitoring cast address: ${this.castAddress}`);
        }
    }

    public onDeposit(callback: DepositCallback): void {
        this.callbacks.add(callback);
    }

    public removeCallback(callback: DepositCallback): void {
        this.callbacks.delete(callback);
    }

    private async notifyCallbacks(event: DepositEvent): Promise<void> {
        for (const callback of this.callbacks) {
            try {
                await callback(event);
            } catch (error) {
                console.error('Error in deposit callback:', error);
            }
        }
    }

    private parseTransactionDetails(tx: any): TransactionDetails | null {
        try {
            const events = tx.events || tx.logs?.[0]?.events || [];
            let amount: string | undefined;
            let receiver: string | undefined;

            // Look for coin_received event
            const coinReceivedEvent = events.find((e: any) => e.type === 'coin_received');
            if (coinReceivedEvent) {
                const attrs = coinReceivedEvent.attributes;
                for (let i = 0; i < attrs.length; i += 2) {
                    const receiverAttr = attrs[i];
                    const amountAttr = attrs[i + 1];
                    
                    if (receiverAttr.key === 'receiver' && 
                        (receiverAttr.value === this.targetAddress || 
                         receiverAttr.value === this.castAddress)) {
                        receiver = receiverAttr.value;
                        amount = amountAttr.value;
                        break;
                    }
                }
            }

            if (!amount || !receiver) return null;

            const messageEvent = events.find((e: any) => e.type === 'message');
            const type = messageEvent?.attributes.find((attr: any) => attr.key === 'action')?.value || 'unknown';

            return {
                hash: tx.txhash || tx.hash,
                height: tx.height,
                type,
                amount,
                receiver,
                sender: messageEvent?.attributes.find((attr: any) => attr.key === 'sender')?.value,
                gasUsed: tx.gas_used,
                gasWanted: tx.gas_wanted,
                timestamp: tx.timestamp,
                raw: tx
            };
        } catch (error) {
            console.error('Error parsing transaction:', error);
            return null;
        }
    }

    public async start(): Promise<void> {
        if (this.isMonitoring) return;
        this.isMonitoring = true;

        // Start both WebSocket and REST monitoring for comprehensive coverage
        await this.startWebSocket();
        this.startRestPolling();
    }

    private async startWebSocket(): Promise<void> {
        try {
            this.ws = new WebSocket(this.config.wsEndpoint + '/websocket');

            this.ws.on('open', () => {
                console.log('WebSocket connected');
                const subscription = {
                    jsonrpc: '2.0',
                    method: 'subscribe',
                    id: 1,
                    params: {
                        query: "tm.event='Tx'"
                    }
                };
                this.ws.send(JSON.stringify(subscription));
            });

            this.ws.on('message', async (data: WebSocket.Data) => {
                try {
                    const response = JSON.parse(data.toString());
                    if (response.result?.data?.value?.TxResult) {
                        const txResult = response.result.data.value.TxResult;
                        const details = this.parseTransactionDetails(txResult);

                        if (details) {
                            const event: DepositEvent = {
                                type: this.determineDepositType(details),
                                transaction: details
                            };
                            await this.notifyCallbacks(event);
                        }
                    }
                } catch (error) {
                    console.error('Error processing WebSocket message:', error);
                }
            });

            this.ws.on('error', (error: Error) => {
                console.error('WebSocket error:', error);
                this.reconnect();
            });

            this.ws.on('close', () => {
                console.log('WebSocket closed, attempting to reconnect...');
                this.reconnect();
            });
        } catch (error) {
            console.error('Error setting up WebSocket:', error);
            this.reconnect();
        }
    }

    private determineDepositType(tx: TransactionDetails): 'direct' | 'evm' | 'cast' {
        if (tx.receiver === this.castAddress) {
            return 'cast';
        } else if (tx.type === '/seiprotocol.seichain.evm.MsgEVMTransaction') {
            return 'evm';
        }
        return 'direct';
    }

    private reconnect(): void {
        if (this.reconnectTimeout) {
            clearTimeout(this.reconnectTimeout);
        }

        this.reconnectTimeout = setTimeout(() => {
            if (this.isMonitoring) {
                this.startWebSocket();
            }
        }, 5000);
    }

    private async startRestPolling(): Promise<void> {
        let lastCheckedBlock = await this.getLatestBlockHeight();

        const poll = async () => {
            if (!this.isMonitoring) return;

            try {
                const currentHeight = await this.getLatestBlockHeight();
                if (currentHeight > lastCheckedBlock) {
                    const transactions = await this.getTransactions(lastCheckedBlock + 1, currentHeight);
                    
                    for (const tx of transactions) {
                        const details = this.parseTransactionDetails(tx);
                        if (details) {
                            const event: DepositEvent = {
                                type: this.determineDepositType(details),
                                transaction: details
                            };
                            await this.notifyCallbacks(event);
                        }
                    }
                    
                    lastCheckedBlock = currentHeight;
                }
            } catch (error) {
                console.error('Error in REST polling:', error);
            }

            setTimeout(poll, 6000);
        };

        poll();
    }

    private async getLatestBlockHeight(): Promise<number> {
        const response = await fetch(`${this.config.restEndpoint}/blocks/latest`);
        const data = await response.json();
        return parseInt(data.block.header.height);
    }

    private async getTransactions(fromBlock: number, toBlock: number): Promise<any[]> {
        const query = `coin_received.receiver='${this.targetAddress}'${
            this.castAddress ? ` OR coin_received.receiver='${this.castAddress}'` : ''
        }`;
        const url = `${this.config.restEndpoint}/cosmos/tx/v1beta1/txs?events=${
            encodeURIComponent(query)
        }&pagination.limit=100`;
        
        const response = await fetch(url);
        const data = await response.json();
        return data.tx_responses || [];
    }

    public stop(): void {
        this.isMonitoring = false;
        if (this.ws) {
            this.ws.close();
            this.ws = null;
        }
        if (this.reconnectTimeout) {
            clearTimeout(this.reconnectTimeout);
            this.reconnectTimeout = null;
        }
    }
}
