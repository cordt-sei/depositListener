// src/types.ts

import { LogLevel } from './logger';

/**
 * Standard network configuration for Sei.
 */
export interface NetworkConfig {
  wsEndpoint: string;
  restEndpoint: string;
  prefix: string;
  evmRpcEndpoint?: string; // if you need EVM address resolution
}

/**
 * Extended config that also supports specifying a log level.
 */
export interface MonitorConfig extends NetworkConfig {
  logLevel?: LogLevel;
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

/**
 * Callback type for deposit events
 */
export type DepositCallback = (event: DepositEvent) => void | Promise<void>;

/**
 * A generic JSON-RPC 2.0 response type for EVM queries.
 * @template ResultType The shape of the `result` field.
 */
export interface JsonRpcResponse<ResultType = string> {
  jsonrpc: '2.0';
  id: number | string | null;
  result?: ResultType;
  error?: {
    code: number;
    message: string;
    data?: any;
  };
}
