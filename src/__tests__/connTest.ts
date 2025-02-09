// src/__tests__/connTest.ts

import WebSocket from 'ws';

async function testConnection(url: string): Promise<void> {
  return new Promise((resolve, reject) => {
    console.log(`Testing connection to ${url}...`);
    const ws = new WebSocket(url);
    const timeout = setTimeout(() => {
      ws.close();
      reject(new Error(`Connection timeout for ${url}`));
    }, 5000);

    ws.on('open', () => {
      console.log('Connection established, sending subscription...');

      const subscription = {
        jsonrpc: '2.0',
        method: 'subscribe',
        id: 1,
        params: {
          query: "tm.event='Tx'"
        }
      };

      ws.send(JSON.stringify(subscription));
    });

    ws.on('message', (data) => {
      const response = JSON.parse(data.toString());
      console.log('Received message:', JSON.stringify(response, null, 2));

      if (response.id === 1 && !response.error) {
        console.log('Successfully subscribed!');
        clearTimeout(timeout);
        ws.close();
        resolve();
      }
    });

    ws.on('error', (error) => {
      console.error('WebSocket error:', error);
      clearTimeout(timeout);
      reject(error);
    });

    ws.on('close', () => {
      console.log('Connection closed');
    });
  });
}

async function main() {
  // We now know that /websocket is required
  const url = 'wss://ws.sei.basementnodes.ca/websocket';

  try {
    await testConnection(url);
    console.log(`✅ Successfully connected and subscribed to ${url}\n`);
  } catch (error) {
    console.error(`❌ Failed to connect to ${url}:`, error, '\n');
  }
}

main().catch(console.error);
