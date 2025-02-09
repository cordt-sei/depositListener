# Sei Deposit Monitor

A comprehensive TypeScript library for monitoring deposits on the [Sei Network](https://sei.io/). This library handles all types of deposits, including direct transfers, EVM transactions, and **cast** address deposits for brand-new EOAs or contract-based (smart) accounts.

## Features

- 🔄 **Real-time monitoring** via WebSocket  
- 📡 **REST API fallback** for reliability  
- 🔍 **Multiple deposit types**:
  - Direct bank transfers
  - EVM transactions (with on-the-fly address resolution)
  - Cast address deposits (for new EOAs not yet recognized on-chain)
- ⚙️ **Address utilities** for hex ↔ bech32 conversions
- 📝 **Full TypeScript support** with comprehensive type definitions
- ⚡ **Automatic reconnection** handling
- 🛡 **Safe** address resolution to avoid sending/monitoring the wrong address
- 🪵 **Configurable logging** with multiple log levels (ERROR → TRACE)

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
  const monitor = new SeiDepositMonitor(
    {
      wsEndpoint: 'wss://ws.sei.basementnodes.ca/websocket',
      restEndpoint: 'https://api.sei.basementnodes.ca',
      prefix: 'sei'
    },
    'sei1qv45ek49hqupx63u8lme9vcylarj3qe7f7cy99'
  );

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

When you pass a `0x` address to `SeiDepositMonitor`:

1. The library calls `eth_getCode` to determine if it’s a **contract** or an **EOA** (Externally Owned Account).  
2. - **Contract** → automatically cast to bech32 for monitoring.  
   - **EOA** → proceeds to step 3.  
3. For an EOA, it calls `eth_getTransactionCount` and checks the Sei “wallets” service:
   - If the chain already has a final recognized bech32 address (via `wallets.sei.basementnodes.ca`), the library monitors that address.
   - If **brand-new** (txCount = `0x0`) and no mapping exists, the library “casts” the `0x` address to a temporary bech32. This “cast address” is valid until the account makes its first on-chain transaction and becomes recognized by Sei.

## Additional Context for “Cast Address”

When monitoring a brand-new EOA with zero transactions, Sei does not yet have a final bech32 address on file. In that scenario:

- The library automatically **casts** the `0x` address to a temporary bech32.  
- Deposits sent to this cast address **will** reach the same account.  
- Once the EOA makes its first transaction, the chain will assign a **permanent** bech32 address, and any further deposits will appear at that final address.  
- If you want to explicitly label such deposits as `'cast'` in your callback, you can customize the `determineDepositType()` method:

```ts
private determineDepositType(details: TransactionDetails): 'direct' | 'evm' | 'cast' {
  if (details.type === '/seiprotocol.seichain.evm.MsgEVMTransaction') {
    return 'evm';
  }
  // If you wish to detect that this deposit used a cast address,
  // you could compare detail.receiver to your known cast address.
  return 'direct';
}
```

## Development

```bash
# Install dependencies
yarn install

# Build
yarn build

# Run unit tests
yarn test:unit

# Run integration tests (requires network access to Sei)
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

   - WebSocket connectivity & subscription  
   - Basic network endpoint checks  

3. **End-to-End Tests** (`yarn test:e2e`):  

   - Runs a live demo  
   - Validates the full deposit detection pipeline

## Configuration

The `SeiDepositMonitor` constructor accepts a `MonitorConfig` object:

```ts
interface MonitorConfig {
  wsEndpoint: string;       // e.g. wss://ws.sei.basementnodes.ca/websocket
  restEndpoint: string;     // e.g. https://api.sei.basementnodes.ca
  prefix: string;           // e.g. 'sei'
  evmRpcEndpoint?: string;  // optional, default = https://evm-rpc.sei.basementnodes.ca
  logLevel?: LogLevel;      // e.g. LogLevel.DEBUG
}
```

## Contributing

1. Fork the repository  
2. Create your feature branch: `git checkout -b feature/my-feature`  
3. Commit your changes: `git commit -am 'Add a feature'`  
4. Push to your branch: `git push origin feature/my-feature`  
5. Open a Pull Request

## License

MIT License

## Support

Please open an issue in GitHub if you encounter any problems or have questions.
