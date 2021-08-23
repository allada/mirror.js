import { LCDClient, Coin } from '@terra-money/terra.js';
import { Mirror } from '../src/client';
import fetch from 'node-fetch';
import pgPromise, { IBaseProtocol, IMain } from 'pg-promise';
import cliProgress from 'cli-progress';
import promiseLimit from 'promise-limit';

// /terra/go_data/bin/terracli --chain-id columbus-4 rest-server --trust-node

const lcd = new LCDClient({
  URL: 'http://172.31.12.209:1317',
  chainID: 'columbus-4',
  gasPrices: [],
  gasAdjustment: '1.2'
});
const mirror = new Mirror({
  lcd,
});

async function getBlock(blockId, retry) {
  if (!blockId) {
    blockId = 'latest';
  }
  try {
    return await lcd.apiRequester.get(`/blocks/${blockId}`, {})
  } catch (e) {
    if (retry < 5) {
      throw e;
    }
    return getBlock(blockId, (retry || 0) + 1);
  }
}

async function getOraclePrice(symbol, height, retry) {
  try {
    return await lcd.apiRequester.get(
      `/wasm/contracts/${mirror.oracle.contractAddress}/store`,
      {
        height,
        query_msg: {
          price: {
            base_asset: mirror.assets[symbol].token.contractAddress,
            quote_asset: "uusd",
          },
        },
      });
  } catch(e) {
    if (retry < 50) {
      throw e;
    }
    return await getOraclePrice(symbol, height, (retry || 0) + 1);
  }
}

async function getPrice(symbol, height, retry) {
  try {
    return await lcd.apiRequester.get(
      `/wasm/contracts/${mirror.assets[symbol].pair.contractAddress}/store`,
      {
        height,
        query_msg: {
          pool: {},
        },
      });
  } catch(e) {
    if (retry < 50) {
      throw e;
    }
    return await getPrice(symbol, height, (retry || 0) + 1);
  }
}

const pgp = pgPromise();
const db = pgp({
  user: 'bsc_importer',
  host: '127.0.0.1',
  database: 'bsc',
  password: 'IiQ4SbQUEJxk',
  port: '5432',
});

function insertDbData(data) {
  return db.none(`${pgp.helpers.insert(data, new pgp.helpers.ColumnSet(
    Object.keys(data[0]),
    { table: 'terra_data' },
  ))}ON CONFLICT DO NOTHING`);
}

async function main() {
  const statusBar = new cliProgress.SingleBar({}, cliProgress.Presets.shades_classic);
  // const END_BLOCK = 3906567;
  const END_BLOCK = Math.floor(3716742 - ((2.628e+6) / 6.85 / 2));
  // const START_BLOCK = Math.floor(END_BLOCK - ((2.628e+6) / 6.85)); // ~1 month.
  // const START_BLOCK = Math.floor(END_BLOCK - ((2.628e+6) / 6.85 / 2)); // ~2 week.
  const START_BLOCK = Math.floor(END_BLOCK - ((2.628e+6) / 6.85 / 4)); // ~1 week.
  // const START_BLOCK = END_BLOCK - 5;
  let tokens = (await db.any(`SELECT id, token FROM terra_tokens
    -- WHERE token = 'mGOOGL'
    `)).map(v => [v.id, v.token]);
  // statusBar.start((END_BLOCK - START_BLOCK) * tokens.length, 0);
  let processed = 0;
  const timerId = setInterval(() => statusBar.update(processed), 5000);
  let limit = promiseLimit(300);
  let localPromises = [];
  let list = (await db.any(`SELECT s.id AS missing_ids
    FROM generate_series(3029004, 4201514) s(id)
    WHERE NOT EXISTS (
    SELECT 1 FROM terra_data
    LEFT JOIN terra_tokens ON terra_tokens.id = terra_data.token
    WHERE
      (block_id = s.id AND terra_tokens.token = 'mTSLA')
    ORDER BY s.id DESC
  );`)).map(v => v.missing_ids);
  // statusBar.start((END_BLOCK - START_BLOCK) * tokens.length, 0);
  statusBar.start((list.length) * tokens.length, 0);
  // for (let i = END_BLOCK; i >= START_BLOCK; --i) {
  for (let i of list) {
    const blockId = i;
    localPromises.push(limit(() => getBlock(blockId).then(async blockInfo => {
      let promises = [];
      for (let [symbolId1, symbol1] of tokens) {
        const symbolId = symbolId1;
        const symbol = symbol1;
        promises.push(Promise.all([
          getPrice(symbol, blockId),
          getOraclePrice(symbol, blockId),
        ]).then(([priceInfo, oraclePriceInfo]) => {
          return {
            token: symbolId,
            ust_balance: priceInfo.result.assets[0].amount,
            token_balance: priceInfo.result.assets[1].amount,
            block_id: blockId,
            oracle_price: parseFloat(oraclePriceInfo.result.rate),
            timestamp: new Date(blockInfo.block.header.time).getTime() / 1000,
          };
        }).finally(() => ++processed));
      }
      const data = await Promise.all(promises);
      await insertDbData(data);
    })).catch(v => Promise.resolve(null)));
  }
  await Promise.all(localPromises);
  localPromises = [];
  statusBar.stop();
  clearInterval(timerId);
}

main().catch(console.error);