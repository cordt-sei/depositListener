// examples/demo.ts

import { SeiDepositMonitor, DepositEvent, LogLevel } from '../dist'; 
// Or if you're running locally without building first, adjust to: 
// import { SeiDepositMonitor, DepositEvent, LogLevel } from '../src';

async function main() {
    // Initialize the monitor with chosen log level (DEBUG for more verbosity, for example)
    const monitor = new SeiDepositMonitor(
        {
            wsEndpoint: 'wss://ws.sei.basementnodes.ca/websocket',
            restEndpoint: 'https://api.sei.basementnodes.ca',
            prefix: 'sei',
            logLevel: LogLevel.DEBUG
        },
        // Either a bech32 address or a 0x address:
        'sei1qv45ek49hqupx63u8lme9vcylarj3qe7f7cy99'
    );

    // Add deposit handler
    monitor.onDeposit((event: DepositEvent) => {
        console.log('\n=== New Deposit Detected ===');
        console.log('Type:', event.type);
        console.log('Transaction Hash:', event.transaction.hash);
        console.log('Amount:', event.transaction.amount);
        console.log('From:', event.transaction.sender);
        console.log('Block Height:', event.transaction.height);
        console.log('Timestamp:', event.transaction.timestamp);

        // Additional type-specific logging
        if (event.type === 'evm') {
            console.log('EVM Transaction deposit detected!');
        } else if (event.type === 'cast') {
            console.log('Cast Address Deposit (for brand-new EOA)!');
        }
    });

    // Start monitoring
    console.log('Starting deposit monitor...');
    await monitor.start();

    // Keep the process running until Ctrl-C
    process.on('SIGINT', () => {
        console.log('Shutting down...');
        monitor.stop();
        process.exit(0);
    });
}

main().catch(console.error);
