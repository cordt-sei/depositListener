// src/__tests__/monitor.test.ts
import { jest, expect, describe, test } from '@jest/globals';
import { SeiDepositMonitor, AddressUtils } from '../index.js';
import type { TransactionDetails } from '../types.js';

describe('SeiDepositMonitor', () => {
  const config = {
    wsEndpoint: 'wss://ws.test.com',
    restEndpoint: 'https://rest.test.com',
    prefix: 'sei'
  };
  const targetAddress = 'sei1qv45ek49hqupx63u8lme9vcylarj3qe7f7cy99';

  test('properly formats WebSocket endpoint', () => {
    const monitor1 = new SeiDepositMonitor(
      {
        ...config,
        wsEndpoint: 'wss://ws.test.com'
      },
      targetAddress
    );

    const monitor2 = new SeiDepositMonitor(
      {
        ...config,
        wsEndpoint: 'wss://ws.test.com/websocket'
      },
      targetAddress
    );

    const config1 = (monitor1 as any).config;
    const config2 = (monitor2 as any).config;

    expect(config1.wsEndpoint).toBe('wss://ws.test.com/websocket');
    expect(config2.wsEndpoint).toBe('wss://ws.test.com/websocket');
  });

  test('initializes with correct configuration', () => {
    const monitor = new SeiDepositMonitor(config, targetAddress);
    expect(monitor).toBeDefined();
    expect((monitor as any).targetAddress).toBe(targetAddress);
  });

  test('correctly identifies deposit types', () => {
    const monitor = new SeiDepositMonitor(config, targetAddress);

    // Access private method for testing
    const determineDepositType = (monitor as any).determineDepositType.bind(monitor);

    const directTx: TransactionDetails = {
      hash: 'abc',
      height: '123',
      type: '/cosmos.bank.v1beta1.MsgSend',
      amount: '100usei',
      receiver: targetAddress,
      gasUsed: '50000',
      gasWanted: '75000',
      timestamp: '2024-02-09T12:00:00Z'
    };

    const evmTx: TransactionDetails = {
      ...directTx,
      type: '/seiprotocol.seichain.evm.MsgEVMTransaction'
    };

    // Suppose the monitor could produce a cast address. We skip if we haven't set one.
    const castTx: TransactionDetails = {
      ...directTx,
      // If you had a real castAddress, you'd do something like:
      receiver: 'sei1castaddressxxxx'
    };

    expect(determineDepositType(directTx)).toBe('direct');
    expect(determineDepositType(evmTx)).toBe('evm');

    // If your determineDepositType checks if receiver === castAddress => 'cast'
    // you'd do:
    // expect(determineDepositType(castTx)).toBe('cast');
    // But your code may or may not do that by default, so adapt as needed.
  });

  test('parses transaction details correctly', () => {
    const monitor = new SeiDepositMonitor(config, targetAddress);
    const parseTransactionDetails = (monitor as any).parseTransactionDetails.bind(monitor);

    const mockTx = {
      txhash: 'abc123',
      height: '123456',
      gas_used: '50000',
      gas_wanted: '75000',
      timestamp: '2024-02-09T12:00:00Z',
      events: [
        {
          type: 'coin_received',
          attributes: [
            { key: 'receiver', value: targetAddress },
            { key: 'amount', value: '100usei' }
          ]
        },
        {
          type: 'message',
          attributes: [
            { key: 'action', value: '/cosmos.bank.v1beta1.MsgSend' },
            { key: 'sender', value: 'sei1sender' }
          ]
        }
      ]
    };

    const results = parseTransactionDetails(mockTx);
    expect(results).toBeDefined();
    expect(Array.isArray(results)).toBe(true);
    expect(results.length).toBe(1);

    const detail = results[0];
    expect(detail.hash).toBe('abc123');
    expect(detail.amount).toBe('100usei');
    expect(detail.receiver).toBe(targetAddress);
    expect(detail.sender).toBe('sei1sender');
    expect(detail.type).toBe('/cosmos.bank.v1beta1.MsgSend');
  });
});

describe('AddressUtils', () => {
  test('converts eth address to bech32 correctly', () => {
    const ethAddress = '0x7b3D6e9756fe4FbdED6881065882323A8C6d9B1A';
    const bech32Address = AddressUtils.ethAddressToBech32(ethAddress, 'sei');
    expect(bech32Address).toMatch(/^sei1/);
  });

  test('converts public key to address correctly', () => {
    const publicKey = Buffer.from(
      '02a9c4ec5e7927c1390a769a1c6ce4c54bda30677676ff3ab32b905d75dcff1960',
      'hex'
    );
    const address = AddressUtils.pubKeyToAddress(publicKey, 'sei');
    expect(address).toMatch(/^sei1/);
  });

  test('detects eth addresses correctly', () => {
    expect(AddressUtils.isEthAddress('0x7b3D6e9756fe4FbdED6881065882323A8C6d9B1A')).toBe(true);
    expect(AddressUtils.isEthAddress('sei1qv45ek49hqupx63u8lme9vcylarj3qe7f7cy99')).toBe(false);
  });

  test('handles invalid eth addresses', () => {
    expect(() => AddressUtils.ethAddressToBech32('invalid', 'sei')).toThrow();
    expect(() => AddressUtils.ethAddressToBech32('0xinvalid', 'sei')).toThrow();
  });

  test('handles different public key formats', () => {
    const hexPubKey =
      '02a9c4ec5e7927c1390a769a1c6ce4c54bda30677676ff3ab32b905d75dcff1960';
    const base64PubKey = Buffer.from(hexPubKey, 'hex').toString('base64');

    const hexAddress = AddressUtils.pubKeyToAddress(hexPubKey, 'sei');
    const base64Address = AddressUtils.pubKeyToAddress(base64PubKey, 'sei');

    expect(hexAddress).toBe(base64Address);
    expect(hexAddress).toMatch(/^sei1/);
  });
});
