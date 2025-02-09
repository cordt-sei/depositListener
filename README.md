# Sei Deposit Monitor

A comprehensive TypeScript library for monitoring deposits on the Sei Network. This library handles all types of deposits including direct transfers, EVM transactions, and cast address deposits.

## Features

- 🔄 Real-time monitoring via WebSocket
- 📡 REST API fallback for reliability
- 🔍 Supports multiple deposit types:
  - Direct bank transfers
  - EVM transactions
  - Cast address deposits (for new accounts)
- 🔐 Address utilities for conversion between formats
- 📝 Full TypeScript support
- ⚡ Automatic reconnection handling
- 🛡️ Comprehensive error handling

## Installation

```bash
yarn add deposit-listener
# or
npm install deposit-listener
```

## Quick Start

```typescript
import { SeiDepositMonitor } from 'deposit-listener';

// Initialize the monitor
const monitor = new SeiDepositMonitor({
    wsEndpoint: 'wss://ws.sei.basementnodes.ca',
    restEndpoint: 'https://api.sei.basementnodes.ca',
    prefix: 'sei'
}, 'sei1qv45ek49hqupx63u8lme9vcylarj3qe7f7cy99');

// Add deposit handler
monitor.onDeposit((event) => {
    console.log('New deposit:', {
        type: event.type,
        amount: event.transaction.amount,
        hash: event.transaction.hash
    });
});

// Start monitoring
await monitor.start();
```

## Deposit Types

### 1. Direct Transfers
Standard bank send transactions using the Cosmos SDK.

### 2. EVM Transactions
Transfers originating from the Sei EVM environment.

### 3. Cast Address Deposits
Special case for new accounts where:
- The deposit is made to a hex address that hasn't been used
- Funds are held by a "cast" address until the first transaction
- The library automatically monitors both the target and cast addresses

## API Reference

### SeiDepositMonitor

#### Constructor
```typescript
constructor(config: NetworkConfig, targetAddress: string)
```

#### Methods
- `start(): Promise<void>` - Start monitoring for deposits
- `stop(): void` - Stop monitoring
- `onDeposit(callback: DepositCallback): void` - Register deposit handler
- `removeCallback(callback: DepositCallback): void` - Remove deposit handler

### AddressUtils

Static utility methods for address manipulation:
- `pubKeyToAddress(publicKey: Uint8Array | string, prefix: string): string`
- `ethAddressToBech32(ethAddress: string, prefix: string): string`
- `isEthAddress(address: string): boolean`

## Development

```bash
# Install dependencies
yarn install

# Build
yarn build

# Run tests
yarn test

# Run demo
yarn start

# Development with auto-reload
yarn watch
```

## Testing

The library includes a comprehensive test suite:

```bash
# Run all tests
yarn test

# Run with coverage
yarn test --coverage
```

## Type Definitions

```typescript
interface NetworkConfig {
    wsEndpoint: string;
    restEndpoint: string;
    prefix: string;
}

interface TransactionDetails {
    hash: string;
    height: string;
    type: string;
    amount: string;
    sender?: string;
    receiver: string;
    gasUsed: string;
    gasWanted: string;
    timestamp: string;
}

interface DepositEvent {
    type: 'direct' | 'evm' | 'cast';
    transaction: TransactionDetails;
}
```

## Error Handling

The library implements comprehensive error handling:
- Automatic WebSocket reconnection
- REST API fallback
- Transaction parsing error recovery
- Network error handling

## Contributing

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## License

MIT

## Support

For support, please open an issue in the GitHub repository.
