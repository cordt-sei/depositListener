// src/__tests__/monitor.test.ts
import { SeiDepositMonitor, AddressUtils } from '../index';
import WebSocket from 'ws';

// Mock WebSocket
jest.mock('ws');
jest.mock('node-fetch');

describe('SeiDepositMonitor', () => {
    const config = {
        wsEndpoint: 'wss://ws.test.com',
        restEndpoint: 'https://rest.test.com',
        prefix: 'sei'
    };
    const targetAddress = 'sei1qv45ek49hqupx63u8lme9vcylarj3qe7f7cy99';

    beforeEach(() => {
        jest.clearAllMocks();
    });

    test('initializes with correct configuration', () => {
        const monitor = new SeiDepositMonitor(config, targetAddress);
        expect(monitor).toBeDefined();
    });

    test('handles WebSocket connection correctly', async () => {
        const monitor = new SeiDepositMonitor(config, targetAddress);
        const mockWs = new WebSocket(null);
        
        // Start monitoring
        await monitor.start();

        // Verify WebSocket connection
        expect(WebSocket).toHaveBeenCalledWith(expect.stringContaining(config.wsEndpoint));
        
        // Simulate WebSocket open event
        mockWs.emit('open');
        
        // Verify subscription message
        expect(mockWs.send).toHaveBeenCalledWith(
            expect.stringContaining('tm.event=\'Tx\'')
        );
    });

    test('processes deposit events correctly', async () => {
        const monitor = new SeiDepositMonitor(config, targetAddress);
        const mockCallback = jest.fn();
        
        monitor.onDeposit(mockCallback);
        await monitor.start();

        const mockWs = new WebSocket(null);
        const mockTxEvent = {
            result: {
                data: {
                    value: {
                        TxResult: {
                            height: '123456',
                            hash: 'ABC123',
                            gas_used: '50000',
                            gas_wanted: '75000',
                            logs: [{
                                events: [{
                                    type: 'coin_received',
                                    attributes: [
                                        { key: 'receiver', value: targetAddress },
                                        { key: 'amount', value: '100000usei' }
                                    ]
                                }]
                            }]
                        }
                    }
                }
            }
        };

        // Simulate receiving transaction event
        mockWs.emit('message', JSON.stringify(mockTxEvent));

        // Verify callback was called with correct data
        expect(mockCallback).toHaveBeenCalledWith(
            expect.objectContaining({
                type: 'direct',
                transaction: expect.objectContaining({
                    hash: 'ABC123',
                    amount: '100000usei'
                })
            })
        );
    });
});

describe('AddressUtils', () => {
    test('converts eth address to bech32 correctly', () => {
        const ethAddress = '0x7b3D6e9756fe4FbdED6881065882323A8C6d9B1A';
        const bech32Address = AddressUtils.ethAddressToBech32(ethAddress, 'sei');
        expect(bech32Address).toMatch(/^sei1/);
    });

    test('converts public key to address correctly', () => {
        const publicKey = Buffer.from('02a9c4ec5e7927c1390a769a1c6ce4c54bda30677676ff3ab32b905d75dcff1960', 'hex');
        const address = AddressUtils.pubKeyToAddress(publicKey, 'sei');
        expect(address).toMatch(/^sei1/);
    });

    test('detects eth addresses correctly', () => {
        expect(AddressUtils.isEthAddress('0x7b3D6e9756fe4FbdED6881065882323A8C6d9B1A')).toBe(true);
        expect(AddressUtils.isEthAddress('sei1qv45ek49hqupx63u8lme9vcylarj3qe7f7cy99')).toBe(false);
    });
});
