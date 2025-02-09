// demo.ts
import { SeiDepositMonitor, DepositEvent } from './src';

async function main() {
    // Initialize the monitor
    const monitor = new SeiDepositMonitor(
        {
            wsEndpoint: 'wss://ws.sei.basementnodes.ca',
            restEndpoint: 'https://api.sei.basementnodes.ca',
            prefix: 'sei'
        },
        'sei1qv45ek49hqupx63u8lme9vcylarj3qe7f7cy99' // Your target address
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
            console.log('EVM Transaction');
        } else if (event.type === 'cast') {
            console.log('Cast Address Deposit');
        }
    });

    // Start monitoring
    console.log('Starting deposit monitor...');
    await monitor.start();

    // Keep the process running
    process.on('SIGINT', () => {
        console.log('Shutting down...');
        monitor.stop();
        process.exit(0);
    });
}

main().catch(console.error);
