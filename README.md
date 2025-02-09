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
    wsEndpoint: 'wss://ws.sei.basementnodes.ca/websocket',
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

## Development

```bash
# Install dependencies
yarn install

# Build
yarn build

# Run unit tests
yarn test:unit

# Run integration tests (requires network connection)
yarn test:integration

# Run end-to-end demo
yarn test:e2e

# Development with auto-reload
yarn dev
```

## Testing Strategy

The library employs a three-layer testing approach:

1. **Unit Tests** (`yarn test:unit`): Tests core logic:

   - Address conversion and validation
   - Transaction type determination
   - Configuration handling
   - Event parsing logic

2. **Integration Tests** (`yarn test:integration`):

   - Tests actual WebSocket connectivity
   - Verifies subscription functionality
   - Checks network endpoint availability

3. **End-to-End Testing** (`yarn test:e2e`):

   - Runs a complete demo setup
   - Monitors real network activity
   - Validates full deposit detection pipeline

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
