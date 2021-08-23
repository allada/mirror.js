const fs = require('fs');
const pgPromise = require('pg-promise');
const { IBaseProtocol, IMain } = pgPromise;

const pgp = pgPromise();
const db = pgp({
  user: 'bsc_importer',
  host: '127.0.0.1',
  database: 'bsc',
  password: 'IiQ4SbQUEJxk',
  port: '5432',
});

const TOKENS = [
    'mGOOGL',
    'mAMZN',
    // 'mGS',
    'mTWTR',
    'mUSO',
    // 'mFB',
    'mNFLX',
    'mMSFT',
    'mTSLA',
    'mAAPL',
    // 'mABNB',
    'mSPY',
]

const INITIAL_UST = 500000;
const ROW_AVG = 5000;
const MINIMUM_DEV = 0.008;

const MIN_BUYSELL_BLOCKS = 2400;
const MIN_UST_BUY_AMT = 5000;
// const BASE_PERC_UST = 0.05;

const PROTOCOL_TX_FEE = 1.6;
const TX_FEE = 0.0037;

async function fetchData(token) {
  return JSON.parse(fs.readFileSync(`/tmp/${token}.txt`));
  const data = await db.any(`
    SELECT
        *,
        avg - GREATEST(stddev, ${MINIMUM_DEV}) AS buy,
        avg + GREATEST(stddev, ${MINIMUM_DEV}) AS sell,
        oracle_price * (avg - GREATEST(stddev, ${MINIMUM_DEV})) AS buy_price,
        oracle_price * (avg + GREATEST(stddev, ${MINIMUM_DEV})) AS sell_price
    FROM
    (SELECT
        date,
        block_id,
        price::float,
        oracle_price::float,
        (price / oracle_price)::float AS delta,
        AVG(price) OVER(ORDER BY date ROWS BETWEEN ${ROW_AVG} PRECEDING AND CURRENT ROW)::float AS avg_price,
        AVG(price / oracle_price) OVER(ORDER BY date ROWS BETWEEN ${ROW_AVG} PRECEDING AND CURRENT ROW)::float AS avg,
        STDDEV_SAMP(price / oracle_price) OVER(ORDER BY date ROWS BETWEEN ${ROW_AVG} PRECEDING AND CURRENT ROW)::float * 1.25 AS stddev,
        ust_balance::float,
        token_balance::float
    FROM (
        SELECT
            MAX(timestamp) as date,
            PERCENTILE_CONT(0.5) WITHIN GROUP(ORDER BY ust_balance / token_balance)::float AS price,
            PERCENTILE_CONT(0.5) WITHIN GROUP(ORDER BY oracle_price)::float AS oracle_price,
            MAX(block_id) AS block_id,
            AVG(ust_balance) AS ust_balance,
            AVG(token_balance) AS token_balance
        FROM
          terra_data
        LEFT JOIN
          terra_tokens ON terra_tokens.id = terra_data.token
        WHERE
          terra_tokens.token = '${token}'
          AND terra_data.timestamp BETWEEN
            extract(epoch from '2021-06-21 23:50:56.194181+00' at time zone 'utc') AND
            extract(epoch from '2021-08-21 23:50:56.194181+00' at time zone 'utc')
            -- extract(epoch from '2021-06-21 23:50:56.194181+00' at time zone 'utc') AND
            -- extract(epoch from '2021-08-21 23:50:56.194181+00' at time zone 'utc')
        GROUP BY
          FLOOR(terra_data.timestamp / 60 / 5)
        ORDER BY block_id ASC
        ) b
    ORDER BY block_id ASC
    ) c
    WHERE date > extract(epoch from '2021-06-21 23:50:56.194181+00' at time zone 'utc')
    ORDER BY block_id ASC`);
  fs.writeFileSync(`/tmp/${token}.txt`, JSON.stringify(data));
  return data;
}

function simulate(token) {
    return fetchData(token);
    // const outData = [];
    // const MAX_BUFFER_SZ = 2000;

    // const prices = data.map(v => v.price / v.oracle_price);
    // for (let {date, price, oracle_price, avg, stddev, buy, sell, buy_price, sell_price, delta} of data) {
    //     outData.push({
    //         date,
    //         price,
    //         oracle_price,
    //         buy,
    //         delta,
    //         sell,
    //         buy_price,
    //         sell_price,
    //     });
    // }
    // return data;
}

function processSimulation(data) {
    let ust = 1;
    let token = 0;
    for (let {date, price, oracle_price, buy_price, sell_price} of data) {
        if (buy_price > price && ust) {
            token = (ust / price) * (1 - TX_FEE);
            ust = 0;
        }
        if (sell_price < price && token) {
            ust = (token * price) * (1 - TX_FEE);
            token = 0;
        }
    }
    return [ust, token];
}

function runOnData(state, entries) {
    // const BASE_PERC_UST = 1.0;

    function getSellAmt(state, token, row) {
        // return 5000;
        // const ustAmt = row.ust_balance / 1e6;
        // const amtOff = (row.price / row.sell_price) - 1;
        // const sellAmt = ustAmt * amtOff;


        // const constant_amt = row.ust_balance * row.token_balance;
        // const tokensSold = (row.token_balance - (constant_amt / (row.ust_balance + (sellAmt * 1e6)))) / 1e6;
        // const newPrice = (row.ust_balance - sellAmt * 1e6) / (tokensSold * 1e6 + row.token_balance);
        // // console.log("sell", {
        // //     sellAmt,
        // //     amtOff,
        // //     tokensSold,
        // //     price_impact: tokensSold / (row.price * tokensSold),
        // //     ustAmt,
        // //     newPrice,
        // //     oldPrice: row.price,
        // //     sell_price: row.sell_price,
        // //     avg_price: row.avg_price,
        // // });
        // return sellAmt;
        // console.log(row, ustAmt * amtOff, amtOff);
        const stddev = row.stddev;
        const STDDEV_MUL = 5;
        return state.tokens[token].balance * Math.min(1.0, stddev * STDDEV_MUL);
    }

    function getBuyAmt(state, token, row) {
        // return 5000;
        // const ustAmt = row.ust_balance / 1e6;
        // const amtOff = 1 - (row.price / row.buy_price);

        // const constant_amt = row.ust_balance * row.token_balance;
        // const inAmt = ustAmt * amtOff;
        // const rawAmt = (constant_amt / (row.ust_balance + inAmt));

        // // console.log("buy", {
        // //     v: ustAmt * amtOff,
        // //     amtOff,
        // //     ustAmt,
        // //     price: row.price,
        // //     buy_price: row.buy_price,
        // //     avg_price: row.price / row.buy_price,
        // // });
        // return ustAmt * amtOff;
        const stddev = row.stddev;
        const STDDEV_MUL = 10;
        return state.ustBalance * Math.min(.95, stddev * STDDEV_MUL);
    }

    function getOutTokens(inAmt, row) {
        const constant_amt = row.ust_balance * row.token_balance;
        const rawOutAmt = row.token_balance - (constant_amt / (row.ust_balance + (inAmt * 1e6)));
        return (rawOutAmt / 1e6) * (1 - TX_FEE);
    }

    function getOutUst(inAmt, row) {
        const constant_amt = row.ust_balance * row.token_balance;
        const rawOutAmt = row.ust_balance - (constant_amt / (row.token_balance + (inAmt * 1e6)));
        return (rawOutAmt / 1e6) * (1 - TX_FEE);
    }

    function processBuy(state, token, row) {
        const tokenState = state.tokens[token];
        tokenState.lastBuySellBlock = row.block_id;
        // tokenState.lastSellBlock = null;
        const amt = Math.min(Math.max(getBuyAmt(state, token, row), MIN_UST_BUY_AMT), state.ustBalance - 1000);
        const gainTokenAmt = getOutTokens(amt, row);
        tokenState.balance += gainTokenAmt;
        state.ustBalance -= (amt + PROTOCOL_TX_FEE);

        console.log(state.ustBalance.toFixed(2), "Buy for", token, "for", row.price, "amt", amt, "avail", tokenState.balance);
    }

    function processSell(state, token, row) {
        const tokenState = state.tokens[token];
        // tokenState.lastBuyBlock = null;
        tokenState.lastBuySellBlock = row.block_id;
        // console.log("perc", getSellAmt(state, token, row));
        const sellTokenAmt = Math.min(getSellAmt(state, token, row), tokenState.balance);
        const gainUstAmt = getOutUst(sellTokenAmt, row);
        state.ustBalance += (gainUstAmt - PROTOCOL_TX_FEE);
        tokenState.balance -= sellTokenAmt;
        console.assert(tokenState.balance >= 0, "Expected balance to never be less than zero");
        console.log(state.ustBalance.toFixed(2), "Sell for", token, "for", row.price, "amt", gainUstAmt, "avail", tokenState.balance);
    }

    let bestBuyToken = null;
    let bestBuyDelta = 0.0;
    for (let token of Object.keys(entries)) {
        const row = entries[token];
        if (!state.tokens[token]) {
            state.tokens[token] = {
                lastBuySellBlock: null,
                balance: 0,
            };
        }
        const tokenState = state.tokens[token];
        if ((tokenState.lastBuySellBlock || 0) > row.block_id - MIN_BUYSELL_BLOCKS) {
            continue;
        }
        if (bestBuyDelta < row.delta && row.buy_price > row.price) {
            bestBuyToken = token;
            bestBuyDelta = row.delta;
        }
        if (row.sell_price < row.price && (tokenState.balance * row.price) > MIN_UST_BUY_AMT) {
            processSell(state, token, row);
        }
    }
    if (bestBuyToken && state.ustBalance > MIN_UST_BUY_AMT) {
        processBuy(state, bestBuyToken, entries[bestBuyToken]);
    }
}

function processAllSimulation(datas) {
    const dataLen = datas[0][1].length;
    let state = {
        ustBalance: INITIAL_UST,
        tokens: {}
    };
    let lastKnownTokenPrices = {};
    for (let i = 0; i < dataLen; i++) {
        const entries = {};
        for (let [token, data] of datas) {
            entries[token] = data[i];
            lastKnownTokenPrices[token] = data[i].price;
        }
        runOnData(state, entries);
    }
    let ustAmt = state.ustBalance;
    for (let token of Object.keys(lastKnownTokenPrices)) {
        const tokenState = state.tokens[token];
        if (!tokenState) {
            continue;
        }
        ustAmt += (tokenState.balance * lastKnownTokenPrices[token]) * (1 - TX_FEE);
    }
    console.log("Final Amt", ustAmt);
    console.log("Final Perc", ustAmt / INITIAL_UST);
}

async function plotData(data, token) {
    let svgData = [[
        'Time',
        'delta',
        'buy',
        'sell',
        'price',
        'avg_price',
        'oracle_price',
        'sell_price',
        'buy_price',
        'block_id',
    ].join("\t")];
    const fistTimestamp = data[0].date;
    svgData = svgData.concat(data.map(v => {
        return [
            v.date - fistTimestamp,
            (v.price / v.oracle_price).toFixed(5),
            v.buy.toFixed(5),
            v.sell.toFixed(5),
            v.price,
            v.avg_price,
            v.oracle_price,
            v.sell_price,
            v.buy_price,
            v.block_id,
        ].join("\t")
    }));

    const rawData = svgData.join("\n");
    await new Promise(v => fs.writeFile(`current.csv`, rawData, v));
}

async function main() {
    const token_datas = await Promise.all(TOKENS.map(async (token) => {
        const data = await simulate(token);
        await plotData(data, token);
        return [token, data];
    }));

    processAllSimulation(token_datas);
    // for (let [token, data] of token_datas) {
    //     const [ust_amt, token_amt] = processSimulation(data);
    //     const initial_token_eqiv = 1 / data[0].buy_price;
    //     console.log({
    //         token,
    //         ust_amt: ust_amt + (token_amt * data[data.length - 1].sell_price),
    //         token_amt: (token_amt + (ust_amt / data[data.length - 1].buy_price)) / initial_token_eqiv,
    //     });
    //     await plotData(data, token);
    // }
    pgp.end();
}

main();
