# Sei Deposit Monitor

A comprehensive TypeScript library for monitoring deposits on the [Sei Network](https://sei.io/). This library handles all types of deposits including direct transfers, EVM transactions, and “cast” address deposits for brand-new EOAs or smart accounts.

## Features

- 🔄 **Real-time monitoring** via WebSocket  
- 📡 **REST API fallback** for reliability  
- 🔍 **Multiple deposit types**:
  - Direct bank transfers
  - EVM transactions (with on-the-fly address resolution)
  - Cast address deposits (for new EOAs not yet recognized on chain)
- ⚙️ **Address utilities** (hex ↔ bech32 conversions)
- 📝 **Full TypeScript support** with comprehensive type definitions
- ⚡ **Automatic reconnection** handling
- 🛡 **Safe** address resolution to avoid sending/monitoring the wrong address
- 🪵 **Configurable logging** with multiple log levels

## Installation

```bash
yarn add deposit-listener
# or
npm install deposit-listener
```

## Quick Start

```typescript
import { SeiDepositMonitor, DepositEvent } from 'deposit-listener';

async function main() {
    // Initialize the monitor
    const monitor = new SeiDepositMonitor({
        wsEndpoint: 'wss://ws.sei.basementnodes.ca/websocket',
        restEndpoint: 'https://api.sei.basementnodes.ca',
        prefix: 'sei'
    }, 'sei1qv45ek49hqupx63u8lme9vcylarj3qe7f7cy99');

    // Add deposit handler
    monitor.onDeposit((event: DepositEvent) => {
        console.log('New deposit:', {
            type: event.type,
            amount: event.transaction.amount,
            hash: event.transaction.hash,
            from: event.transaction.sender
        });
    });

    // Start monitoring
    await monitor.start();
}

main().catch(console.error);
```

## EVM Addresses

When you pass a `0x` address:

1. We call `eth_getCode` to check if it’s a contract or an EOA.
2. If it’s a contract, we cast immediately to bech32.
3. If it’s an EOA, we check `eth_getTransactionCount` plus the chain’s “wallets” service to see if the user has a final recognized address. If not found (brand-new EOA), we cast the address ourselves until it’s used in a transaction.

## 4. **Additional Context for “Cast Address”**  

Below is an example snippet you could include in your **README** or inline docs to emphasize the cast address scenario:

> **Cast Address Deposits**  
> When monitoring a brand-new EOA (Externally Owned Account) that has never made a transaction on Sei, the chain does not yet recognize a “final” bech32 address. In this case, the library automatically **casts** the 0x address to a temporary bech32 address.  
>
> - If you send funds to this cast address **before** the EOA’s first transaction, they will arrive at the same location as the future recognized bech32 address.  
> - Once the user broadcasts their first transaction, the chain will assign a **permanent** bech32 address and any further deposits will appear at that final address.  
> - The library checks the “wallets.sei.basementnodes.ca” mapping to see if the chain has an official recognized address for the EOA. If not, it falls back to the cast.  

You can also choose to highlight in code that you set deposits to type `'cast'` if you want to differentiate them. For instance:

```ts
private determineDepositType(details: TransactionDetails): 'direct' | 'evm' | 'cast' {
  if (details.type === '/seiprotocol.seichain.evm.MsgEVMTransaction') {
    return 'evm';
  }
  // If you have a condition for cast:
  // if (somehow know it's cast) { return 'cast'; }
  return 'direct';
}

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

## Testing

We employ a **three-layer** testing approach:

1. **Unit Tests** (`yarn test:unit`):  

   - Address conversion & validation  
   - Transaction parsing logic  
   - Configuration handling  

2. **Integration Tests** (`yarn test:integration`):  

   - Actual WebSocket connectivity & subscription  
   - Basic network endpoint checks  

3. **End-to-End Testing** (`yarn test:e2e`):  

   - Runs the demo against a live endpoint  
   - Validates deposit detection pipeline

## Configuration

All configuration is passed via the `MonitorConfig` interface:

```ts
interface MonitorConfig {
  wsEndpoint: string;       // e.g. wss://ws.sei.basementnodes.ca/websocket
  restEndpoint: string;     // e.g. https://api.sei.basementnodes.ca
  prefix: string;           // e.g. 'sei'
  evmRpcEndpoint?: string;  // optional, defaults to https://evm-rpc.sei.basementnodes.ca
  logLevel?: LogLevel;      // e.g. LogLevel.DEBUG
}
```

## Contributing

1. Fork the repository  
2. Create your feature branch: `git checkout -b feature/my-feature`  
3. Commit your changes: `git commit -am 'Add a feature'`  
4. Push to the branch: `git push origin feature/my-feature`  
5. Open a Pull Request

## License

MIT License

## Support

Please open an issue in GitHub if you encounter any problems or have questions.
