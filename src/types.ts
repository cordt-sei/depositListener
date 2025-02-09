// src/types.ts

export interface NetworkConfig {
    wsEndpoint: string;
    restEndpoint: string;
    prefix: string;
}

export interface TransactionDetails {
    hash: string;
    height: string;
    type: string;
    amount: string;
    sender?: string;
    receiver: string;
    gasUsed: string;
    gasWanted: string;
    timestamp: string;
    raw?: any;
}

export interface DepositEvent {
    type: 'direct' | 'evm' | 'cast';
    transaction: TransactionDetails;
}

export type DepositCallback = (event: DepositEvent) => void | Promise<void>;
