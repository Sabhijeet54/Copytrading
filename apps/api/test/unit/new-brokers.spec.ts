/**
 * Dhan / Fyers / Kotak Neo / 5paisa: instrument-master mapping and order request shapes, with the network
 * mocked (sample rows follow each broker's published file format).
 */
type Call = { url: string; init: { method?: string; headers?: Record<string, string>; body?: string } };
const calls: Call[] = [];
let routes: [RegExp, (c: Call) => { status?: number; text: string }][] = [];

jest.mock('undici', () => {
  const actual = jest.requireActual('undici');
  return {
    ...actual,
    fetch: jest.fn(async (url: string, init: Call['init'] = {}) => {
      const c = { url: String(url), init };
      calls.push(c);
      const r = routes.find(([re]) => re.test(String(url)));
      if (!r) throw new Error(`unmocked ${url}`);
      const out = r[1](c);
      return { ok: (out.status ?? 200) < 400, status: out.status ?? 200, text: async () => out.text };
    }),
  };
});

import { DhanAdapter, dhanInstruments } from '../../src/trading/dhan.adapter';
import { FyersAdapter, fyersInstruments } from '../../src/trading/fyers.adapter';
import { KotakNeoAdapter, kotakInstruments } from '../../src/trading/kotak.adapter';
import { FivePaisaAdapter, fivePaisaInstruments } from '../../src/trading/fivepaisa.adapter';

const json = (v: unknown) => ({ text: JSON.stringify(v) });
const epoch = (d: string) => Math.floor(new Date(`${d}T14:30:00+05:30`).getTime() / 1000);

beforeEach(() => {
  calls.length = 0;
});

describe('Dhan', () => {
  beforeAll(() => {
    routes = [
      [
        /api-scrip-master\.csv/,
        () => ({
          text: [
            'SEM_EXM_EXCH_ID,SEM_SEGMENT,SEM_SMST_SECURITY_ID,SEM_INSTRUMENT_NAME,SEM_EXPIRY_CODE,SEM_TRADING_SYMBOL,SEM_LOT_UNITS,SEM_CUSTOM_SYMBOL,SEM_EXPIRY_DATE,SEM_STRIKE_PRICE,SEM_OPTION_TYPE,SEM_TICK_SIZE,SEM_EXPIRY_FLAG,SEM_EXCH_INSTRUMENT_TYPE,SEM_SERIES,SM_SYMBOL_NAME',
            'NSE,D,45678,OPTIDX,0,NIFTY-Oct2026-25000-CE,75.0,NIFTY 27 OCT 25000 CALL,2026-10-27 14:30:00,25000.00000,CE,5.0000,M,OP,NA,NIFTY',
            'BSE,D,8123,OPTIDX,0,SENSEX-Oct2026-74500-PE,20.0,SENSEX 22 OCT 74500 PUT,2026-10-22 14:30:00,74500.00000,PE,5.0000,W,OP,NA,SENSEX',
            'NSE,E,2885,EQUITY,0,RELIANCE,1.0,Reliance Industries,,,XX,10.0000,NA,ES,EQ,RELIANCE INDUSTRIES LTD',
          ].join('\n'),
        }),
      ],
      [/api\.dhan\.co\/v2\/orders$/, (c) => (c.init.method === 'POST' ? json({ orderId: '112111182198', orderStatus: 'PENDING' }) : json([]))],
    ];
  });

  it('maps the scrip master to canonical symbols', async () => {
    await dhanInstruments.ensure('NFO');
    expect(dhanInstruments.get('NFO', 'NIFTY27OCT2625000CE')).toMatchObject({ key: '45678', lotSize: 75 });
    expect(dhanInstruments.get('BFO', 'SENSEX22OCT2674500PE')).toMatchObject({ key: '8123' });
    expect(dhanInstruments.get('NSE', 'RELIANCE')).toMatchObject({ key: '2885' });
  });

  it('places an order with exchangeSegment + securityId', async () => {
    const a = new DhanAdapter('1000000001', 'jwt');
    const r = await a.placeOrder({ exchange: 'NFO', symbol: 'NIFTY27OCT2625000CE', side: 'BUY', quantity: 75, orderType: 'MARKET', productType: 'INTRADAY', tag: 'ctp copy#1' });
    expect(r.brokerOrderId).toBe('112111182198');
    const c = calls.find((x) => x.init.method === 'POST')!;
    expect(c.init.headers).toMatchObject({ 'access-token': 'jwt', 'client-id': '1000000001' });
    expect(JSON.parse(c.init.body!)).toMatchObject({
      dhanClientId: '1000000001',
      exchangeSegment: 'NSE_FNO',
      securityId: '45678',
      productType: 'INTRADAY',
      orderType: 'MARKET',
      transactionType: 'BUY',
      quantity: 75,
      price: 0,
      correlationId: 'ctp copy1',
    });
  });
});

describe('Fyers', () => {
  beforeAll(() => {
    const row = (ticker: string, exp: number, under: string, strike: string, opt: string, lot = 75) =>
      ['101126102745678', 'NIFTY 27 Oct 26 25000 CE', '14', String(lot), '0.05', '', '0915-1530|1815-1915:', '1760000000', String(exp), ticker, '10', '11', '45678', under, '26000', strike, opt, '101000000026000', 'None', '0', '0.0'].join(',');
    routes = [
      [/NSE_FO\.csv/, () => ({ text: [row('NSE:NIFTY26O2725000CE', epoch('2026-10-27'), 'NIFTY', '25000.0', 'CE'), row('NSE:NIFTY26OCTFUT', epoch('2026-10-27'), 'NIFTY', '-1.0', 'XX')].join('\n') })],
      [/NSE_CM\.csv/, () => ({ text: row('NSE:SBIN-EQ', 0, 'SBIN', '-1.0', 'XX', 1) })],
      [/orders\/sync/, () => json({ s: 'ok', code: 1101, message: 'Order submitted successfully.', id: '808058117761' })],
      [/api\/v3\/orders$/, () => json({ s: 'ok', code: 200, orderBook: [{ id: '808058117761', symbol: 'NSE:NIFTY26O2725000CE', qty: 75, filledQty: 75, tradedPrice: 120.5, type: 2, side: 1, productType: 'INTRADAY', status: 2, orderDateTime: '16-Oct-2026 10:15:22' }] })],
    ];
  });

  it('maps tickers both ways', async () => {
    await fyersInstruments.ensure('NFO');
    await fyersInstruments.ensure('NSE');
    expect(fyersInstruments.get('NFO', 'NIFTY27OCT2625000CE')?.key).toBe('NSE:NIFTY26O2725000CE');
    expect(fyersInstruments.get('NFO', 'NIFTY27OCT26FUT')?.key).toBe('NSE:NIFTY26OCTFUT');
    expect(fyersInstruments.get('NSE', 'SBIN')?.key).toBe('NSE:SBIN-EQ');
  });

  it('places with the Fyers ticker and reads the order book back to canonical', async () => {
    const a = new FyersAdapter('XC4XXXXM-100', 'tok');
    await a.placeOrder({ exchange: 'NFO', symbol: 'NIFTY27OCT2625000CE', side: 'SELL', quantity: 75, orderType: 'LIMIT', price: 120, productType: 'CARRY_FORWARD', tag: 'ctp-copy' });
    const c = calls.find((x) => /orders\/sync/.test(x.url))!;
    expect(c.init.headers?.Authorization).toBe('XC4XXXXM-100:tok');
    expect(JSON.parse(c.init.body!)).toMatchObject({ symbol: 'NSE:NIFTY26O2725000CE', side: -1, type: 1, limitPrice: 120, productType: 'MARGIN', orderTag: 'ctpcopy' });
    const book = await a.orders();
    expect(book[0]).toMatchObject({ exchange: 'NFO', symbol: 'NIFTY27OCT2625000CE', status: 'FILLED', filledQuantity: 75, averagePrice: 120.5, side: 'BUY' });
  });
});

describe('Kotak Neo', () => {
  beforeAll(() => {
    // Header and HDFCAMC row from Kotak's own SDK sample (expiry counted from 1980, strike in paise).
    const header =
      'pSymbol,pGroup,pExchSeg,pInstType,pSymbolName,pTrdSymbol,pOptionType,pScripRefKey,pISIN,pAssetCode,pSubGroup,pCombinedSymbol,pDesc,pAmcCode,pContractId,dTickSize ,lLotSize,lExpiryDate ,lMultiplier ,lPrecision,dStrikePrice;';
    const opt = '129315,XX,nse_fo,OPTSTK,HDFCAMC,HDFCAMC23APR1680CE,CE,HDFCAMC23APR1680CE,,4244,,,,,,5,300,1367073000,-1,2,168000';
    routes = [
      [/masterscrip\/file-paths/, () => json({ data: { filesPaths: ['https://lapi.kotaksecurities.com/x/nse_cm.csv', 'https://lapi.kotaksecurities.com/x/nse_fo.csv'] } })],
      [/nse_fo\.csv/, () => ({ text: `${header}\n${opt}\n` })],
      [/quick\/order\/rule\/ms\/place/, () => json({ stat: 'Ok', nOrdNo: '250122000612876', stCode: 200 })],
    ];
  });

  it('decodes the 1980-based expiry and paise strike', async () => {
    await kotakInstruments.ensure('NFO', { baseUrl: 'https://mnapi.kotaksecurities.com', consumerKey: 'ck' });
    expect(kotakInstruments.get('NFO', 'HDFCAMC27APR231680CE')).toMatchObject({ key: '129315', lotSize: 300, tradingSymbol: 'HDFCAMC23APR1680CE' });
  });

  it('posts jData with Auth / Sid headers and sId query', async () => {
    const a = new KotakNeoAdapter({ token: 'trade', sid: 'sid1', serverId: 'server4', baseUrl: 'https://mnapi.kotaksecurities.com/', consumerKey: 'ck' });
    const r = await a.placeOrder({ exchange: 'NFO', symbol: 'HDFCAMC27APR231680CE', side: 'BUY', quantity: 300, orderType: 'MARKET', productType: 'INTRADAY' });
    expect(r.brokerOrderId).toBe('250122000612876');
    const c = calls.find((x) => /ms\/place/.test(x.url))!;
    expect(c.url).toContain('?sId=server4');
    expect(c.init.headers).toMatchObject({ Sid: 'sid1', Auth: 'trade', 'Content-Type': 'application/x-www-form-urlencoded' });
    const j = JSON.parse(new URLSearchParams(c.init.body!).get('jData')!);
    expect(j).toMatchObject({ es: 'nse_fo', ts: 'HDFCAMC23APR1680CE', tk: '129315', pt: 'MKT', pc: 'MIS', tt: 'B', qt: '300', pr: '0' });
  });
});

describe('5paisa', () => {
  beforeAll(() => {
    const header = 'Exch,ExchType,ScripCode,ScripData,Name,Expiry,ScripType,StrikeRate,ISIN,LotSize,FullName,QtyLimit,TickSize,Multiplier,BOCOAllowed,SymbolRoot,Series';
    routes = [
      [
        /ScripMaster\/segment\/nse_fo/,
        () => ({
          text: `${header}\nN,D,43899,BANKNIFTY 27 Oct 2026 CE 52000.00_20261027_CE_52000,BANKNIFTY 27 Oct 2026 CE 52000.00,2026-10-27 14:30:00,CE,52000,,35,BANKNIFTY 27 Oct 2026 CE 52000.00,900,0.05,1,N,BANKNIFTY,XX\n`,
        }),
      ],
      [/ScripMaster\/segment\/nse_eq/, () => ({ text: `${header}\nN,C,1660,ITC_EQ,ITC,,XX,0,INE154A01025,1,ITC LTD,50000,0.05,1,Y,ITC,EQ\n` })],
      [/V1\/PlaceOrderRequest/, () => json({ head: { status: '0' }, body: { BrokerOrderID: 182747604, ExchOrderID: 0, Status: 0, Message: 'Success' } })],
    ];
  });

  it('maps ScripData to canonical symbols', async () => {
    await fivePaisaInstruments.ensure('NFO');
    await fivePaisaInstruments.ensure('NSE');
    expect(fivePaisaInstruments.get('NFO', 'BANKNIFTY27OCT2652000CE')).toMatchObject({ key: '43899', lotSize: 35 });
    expect(fivePaisaInstruments.get('NSE', 'ITC')).toMatchObject({ key: '1660', tradingSymbol: 'ITC_EQ' });
  });

  it('places with Exchange / ExchangeType / ScripCode in the head-body envelope', async () => {
    const a = new FivePaisaAdapter({ token: 'jwt', userKey: 'uk', clientCode: '5012345' });
    const r = await a.placeOrder({ exchange: 'NFO', symbol: 'BANKNIFTY27OCT2652000CE', side: 'SELL', quantity: 35, orderType: 'MARKET', productType: 'INTRADAY' });
    expect(r.brokerOrderId).toBe('182747604');
    const c = calls.find((x) => /PlaceOrderRequest/.test(x.url))!;
    expect(c.init.headers?.Authorization).toBe('bearer jwt');
    const b = JSON.parse(c.init.body!);
    expect(b.head).toEqual({ key: 'uk' });
    expect(b.body).toMatchObject({ ClientCode: '5012345', Exchange: 'N', ExchangeType: 'D', ScripCode: 43899, OrderType: 'S', Qty: 35, IsIntraday: true, Price: 0 });
  });
});
