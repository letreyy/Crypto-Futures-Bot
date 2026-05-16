// Parse Telegram bot export from Crypto-Futures-Bot (LTF)
const fs = require('fs');
const data = JSON.parse(fs.readFileSync('D:/projects/Crypto-Futures-Bot/result.json', 'utf-8'));
const messages = data.messages;
console.log(`Bot: ${data.name} | ID: ${data.id} | Messages: ${messages.length}`);

function getText(msg) {
    if (!msg.text) return '';
    if (typeof msg.text === 'string') return msg.text;
    if (Array.isArray(msg.text)) return msg.text.map(t => typeof t === 'string' ? t : (t.text || '')).join('');
    return '';
}

const trades = [];
const signals = [];

for (const msg of messages) {
    if (msg.from_id !== `user${data.id}`) continue; // only bot messages
    const text = getText(msg);

    // ─── Trade results: [PAPER TRADE] 🏆 WON / 📉 LOSS ───
    const tradeMatch = text.match(/\[PAPER TRADE\]\s*(🏆\s*WON|📉\s*LOSS)\s*\|\s*(\w+)\s+(LONG|SHORT)/);
    if (tradeMatch) {
        const isWin = text.includes('WON');
        const pair = tradeMatch[2];
        const direction = tradeMatch[3];
        const resultMatch = text.match(/Result:\s*([+-]?\d+\.?\d*)%/);
        const totalMatch = text.match(/Total Today:\s*([+-]?\d+\.?\d*)%/);
        
        // Parse trade log entries
        const logEntries = [...text.matchAll(/\d+\.\s*\[(\d{2}:\d{2})\]\s*(.*?)(?=\n|$)/g)];
        
        // Determine exit type
        const tpHits = [...text.matchAll(/TP(\d) hit/g)].map(m => parseInt(m[1]));
        const hasSLHit = text.includes('SL hit');
        const hasTimeStop = text.includes('Time-stop');
        const hasDCA = (text.match(/DCA/g) || []).length;
        
        let exitType = 'Unknown';
        if (hasTimeStop) exitType = 'TimeStop';
        else if (hasSLHit && tpHits.length > 0) exitType = `TP${Math.max(...tpHits)}+SL`;
        else if (hasSLHit) exitType = 'SL';
        else if (tpHits.length > 0) exitType = `TP${Math.max(...tpHits)}`;
        
        // Duration
        let durationMinutes = null;
        if (logEntries.length >= 2) {
            const [h1, m1] = logEntries[0][1].split(':').map(Number);
            const [h2, m2] = logEntries[logEntries.length - 1][1].split(':').map(Number);
            let dur = (h2 * 60 + m2) - (h1 * 60 + m1);
            if (dur < 0) dur += 24 * 60;
            durationMinutes = dur;
        }

        // Entry type
        const isLimit = text.includes('Limit set at') || text.includes('Limit Filled');
        const isMarket = text.includes('Market entry');

        trades.push({
            date: msg.date, pair, direction, isWin,
            result: resultMatch ? parseFloat(resultMatch[1]) : 0,
            totalToday: totalMatch ? parseFloat(totalMatch[1]) : null,
            exitType, tpHits, hasDCA, durationMinutes,
            orderType: isLimit ? 'LIMIT' : isMarket ? 'MARKET' : 'UNKNOWN',
            maxTP: tpHits.length > 0 ? Math.max(...tpHits) : 0,
        });
        continue;
    }
    
    // ─── Signals ───
    const signalMatch = text.match(/(🟢\s*LONG|🔴\s*SHORT)\s*\|\s*(\w+)\s*/i);
    if (signalMatch && !tradeMatch) {
        const strategyMatch = text.match(/Strategy:\s*(.+?)(?:\n|$)/);
        const scoreMatch = text.match(/Score:\s*(\d+)\/100/);
        const regimeMatch = text.match(/Regime:\s*(\w+)/);
        const rrMatch = text.match(/Risk\/Reward:\s*1:([\d.]+)/);
        const leverageMatch = text.match(/Leverage:\s*x(\d+)/);
        const orderTypeMatch = text.match(/(MARKET|LIMIT)\s*Entry/);
        const slPctMatch = text.match(/Stop Loss:.*?\((-?[\d.]+)%\)/);
        const tp1PctMatch = text.match(/TP1:.*?\(\+?([\d.]+)%\)/);
        
        signals.push({
            date: msg.date,
            pair: signalMatch[2],
            direction: signalMatch[1].includes('LONG') ? 'LONG' : 'SHORT',
            strategy: strategyMatch ? strategyMatch[1].trim() : 'Unknown',
            score: scoreMatch ? parseInt(scoreMatch[1]) : null,
            regime: regimeMatch ? regimeMatch[1] : null,
            rr: rrMatch ? parseFloat(rrMatch[1]) : null,
            leverage: leverageMatch ? parseInt(leverageMatch[1]) : null,
            orderType: orderTypeMatch ? orderTypeMatch[1] : null,
            slPct: slPctMatch ? parseFloat(slPctMatch[1]) : null,
            tp1Pct: tp1PctMatch ? parseFloat(tp1PctMatch[1]) : null,
        });
    }
}

// ═══════════════════════════════════════════
// REPORT
// ═══════════════════════════════════════════
const SEP = '═'.repeat(70);
console.log(`\n${SEP}`);
console.log(`  TRADES: ${trades.length} | SIGNALS: ${signals.length}`);
console.log(`${SEP}\n`);

if (trades.length === 0) { console.log('No trades found!'); process.exit(0); }

const wins = trades.filter(t => t.isWin);
const losses = trades.filter(t => !t.isWin);
const totalPnl = trades.reduce((s, t) => s + t.result, 0);
const avgWin = wins.length > 0 ? wins.reduce((s,t) => s+t.result, 0) / wins.length : 0;
const avgLoss = losses.length > 0 ? losses.reduce((s,t) => s+t.result, 0) / losses.length : 0;
const grossProfit = wins.reduce((s,t) => s+t.result, 0);
const grossLoss = Math.abs(losses.reduce((s,t) => s+t.result, 0));
const pf = grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? 999 : 0;

console.log(`Win Rate: ${(wins.length/trades.length*100).toFixed(1)}% (${wins.length}W / ${losses.length}L)`);
console.log(`Total PnL: ${totalPnl > 0 ? '+' : ''}${totalPnl.toFixed(2)}%`);
console.log(`Avg Win: +${avgWin.toFixed(2)}% | Avg Loss: ${avgLoss.toFixed(2)}%`);
console.log(`Profit Factor: ${pf.toFixed(2)}`);
console.log(`Avg Win/Loss ratio: ${Math.abs(avgWin/avgLoss).toFixed(2)}`);

// BY DIRECTION
console.log(`\n--- BY DIRECTION ---`);
for (const dir of ['LONG', 'SHORT']) {
    const dt = trades.filter(t => t.direction === dir);
    const dw = dt.filter(t => t.isWin);
    const dpnl = dt.reduce((s, t) => s + t.result, 0);
    console.log(`${dir}: ${dt.length} trades, WR: ${dt.length ? (dw.length/dt.length*100).toFixed(1) : 0}%, PnL: ${dpnl > 0 ? '+' : ''}${dpnl.toFixed(2)}%`);
}

// BY EXIT TYPE
console.log(`\n--- BY EXIT TYPE ---`);
const exitTypes = {};
for (const t of trades) {
    if (!exitTypes[t.exitType]) exitTypes[t.exitType] = { count: 0, pnl: 0, wins: 0 };
    exitTypes[t.exitType].count++;
    exitTypes[t.exitType].pnl += t.result;
    if (t.isWin) exitTypes[t.exitType].wins++;
}
for (const [type, d] of Object.entries(exitTypes).sort((a,b) => b[1].count - a[1].count)) {
    console.log(`${type.padEnd(12)}: ${d.count} trades, WR: ${(d.wins/d.count*100).toFixed(0)}%, PnL: ${d.pnl > 0 ? '+' : ''}${d.pnl.toFixed(2)}%`);
}

// Link signals to trades
const linkedTrades = [];
for (const trade of trades) {
    const tradeTime = new Date(trade.date).getTime();
    let bestSignal = null, bestDiff = Infinity;
    for (const sig of signals) {
        if (sig.pair === trade.pair && sig.direction === trade.direction) {
            const diff = tradeTime - new Date(sig.date).getTime();
            if (diff > 0 && diff < 48*60*60*1000 && diff < bestDiff) {
                bestDiff = diff;
                bestSignal = sig;
            }
        }
    }
    linkedTrades.push({ ...trade, strategy: bestSignal?.strategy || '???', score: bestSignal?.score, regime: bestSignal?.regime, rr: bestSignal?.rr, leverage: bestSignal?.leverage, slPct: bestSignal?.slPct, tp1Pct: bestSignal?.tp1Pct, signalOrderType: bestSignal?.orderType });
}
console.log(`\nLinked ${linkedTrades.filter(t => t.strategy !== '???').length}/${trades.length} trades to signals`);

// STRATEGY PERFORMANCE
console.log(`\n--- STRATEGY PERFORMANCE ---`);
const stratPerf = {};
for (const t of linkedTrades) {
    if (!stratPerf[t.strategy]) stratPerf[t.strategy] = { trades: 0, wins: 0, pnl: 0, results: [], regimes: {} };
    const sp = stratPerf[t.strategy];
    sp.trades++;
    if (t.isWin) sp.wins++;
    sp.pnl += t.result;
    sp.results.push(t.result);
    if (t.regime) { sp.regimes[t.regime] = (sp.regimes[t.regime] || 0) + 1; }
}
for (const [name, d] of Object.entries(stratPerf).sort((a,b) => a[1].pnl - b[1].pnl)) {
    const regStr = Object.entries(d.regimes).map(([k,v])=>`${k}:${v}`).join(' ');
    console.log(`  ${name}: ${d.trades} trades, WR: ${(d.wins/d.trades*100).toFixed(0)}%, PnL: ${d.pnl > 0 ? '+' : ''}${d.pnl.toFixed(2)}%, range: [${Math.min(...d.results).toFixed(2)} to +${Math.max(...d.results).toFixed(2)}] | ${regStr}`);
}

// DAILY PNL
console.log(`\n--- DAILY PNL ---`);
const dailyPnl = {};
for (const t of trades) {
    const day = t.date.substring(0, 10);
    if (!dailyPnl[day]) dailyPnl[day] = { pnl: 0, trades: 0, wins: 0 };
    dailyPnl[day].pnl += t.result;
    dailyPnl[day].trades++;
    if (t.isWin) dailyPnl[day].wins++;
}
let cumPnl = 0;
for (const [day, d] of Object.entries(dailyPnl).sort()) {
    cumPnl += d.pnl;
    console.log(`${day}: ${String(d.trades).padStart(2)} trades, PnL: ${d.pnl > 0 ? '+' : ''}${d.pnl.toFixed(2).padStart(7)}%, WR: ${(d.wins/d.trades*100).toFixed(0).padStart(3)}%, cum: ${cumPnl > 0 ? '+' : ''}${cumPnl.toFixed(2)}%`);
}

// BY PAIR
console.log(`\n--- TOP LOSING PAIRS ---`);
const pairStats = {};
for (const t of trades) {
    if (!pairStats[t.pair]) pairStats[t.pair] = { count: 0, pnl: 0, wins: 0 };
    pairStats[t.pair].count++;
    pairStats[t.pair].pnl += t.result;
    if (t.isWin) pairStats[t.pair].wins++;
}
for (const [pair, d] of Object.entries(pairStats).sort((a,b) => a[1].pnl - b[1].pnl).slice(0, 15)) {
    console.log(`${pair.padEnd(14)}: ${d.count} trades, WR: ${(d.wins/d.count*100).toFixed(0)}%, PnL: ${d.pnl > 0 ? '+' : ''}${d.pnl.toFixed(2)}%`);
}

// REGIME
console.log(`\n--- REGIME vs OUTCOME ---`);
const regimePerf = {};
for (const t of linkedTrades) {
    const key = t.regime || 'UNKNOWN';
    if (!regimePerf[key]) regimePerf[key] = { trades: 0, wins: 0, pnl: 0 };
    regimePerf[key].trades++;
    if (t.isWin) regimePerf[key].wins++;
    regimePerf[key].pnl += t.result;
}
for (const [r, d] of Object.entries(regimePerf).sort((a,b) => a[1].pnl - b[1].pnl)) {
    console.log(`${r.padEnd(12)}: ${d.trades} trades, WR: ${(d.wins/d.trades*100).toFixed(0)}%, PnL: ${d.pnl > 0 ? '+' : ''}${d.pnl.toFixed(2)}%`);
}

// SCORE
console.log(`\n--- SCORE vs OUTCOME ---`);
for (const range of ['70-79', '80-89', '90-100']) {
    const [lo, hi] = range.split('-').map(Number);
    const rt = linkedTrades.filter(t => t.score >= lo && t.score <= hi);
    const rw = rt.filter(t => t.isWin);
    const rp = rt.reduce((s,t) => s + t.result, 0);
    console.log(`Score ${range}: ${rt.length} trades, WR: ${rt.length ? (rw.length/rt.length*100).toFixed(0) : 0}%, PnL: ${rp.toFixed(2)}%`);
}

// DURATION
console.log(`\n--- TRADE DURATION ---`);
const durs = trades.filter(t => t.durationMinutes !== null);
if (durs.length > 0) {
    const winD = durs.filter(t => t.isWin);
    const lossD = durs.filter(t => !t.isWin);
    console.log(`Overall avg: ${(durs.reduce((s,t)=>s+t.durationMinutes,0)/durs.length).toFixed(0)} min`);
    if (winD.length) console.log(`Win avg: ${(winD.reduce((s,t)=>s+t.durationMinutes,0)/winD.length).toFixed(0)} min`);
    if (lossD.length) console.log(`Loss avg: ${(lossD.reduce((s,t)=>s+t.durationMinutes,0)/lossD.length).toFixed(0)} min`);
}

// LAST 30 TRADES
console.log(`\n--- LAST 30 TRADES ---`);
for (const t of trades.slice(-30)) {
    const icon = t.isWin ? '✅' : '❌';
    const lt = linkedTrades.find(l => l.date === t.date && l.pair === t.pair);
    const strat = (lt?.strategy || '???').substring(0, 22).padEnd(22);
    const reg = (lt?.regime || '?').substring(0, 5).padEnd(5);
    console.log(`${icon} ${t.date.substring(5,16)} ${t.pair.padEnd(12)} ${t.direction.padEnd(5)} ${(t.result>0?'+':'')+t.result.toFixed(2).padStart(6)}% ${t.exitType.padEnd(10)} ${t.orderType.padEnd(6)} ${strat} ${reg} dur:${t.durationMinutes||'?'}m`);
}

// ALL WINS (if < 20)
if (wins.length > 0 && wins.length <= 25) {
    console.log(`\n--- ALL ${wins.length} WINNING TRADES ---`);
    for (const t of wins) {
        const lt = linkedTrades.find(l => l.date === t.date && l.pair === t.pair);
        console.log(`✅ ${t.date.substring(5,16)} ${t.pair.padEnd(12)} ${t.direction.padEnd(5)} +${t.result.toFixed(2)}% exit:${t.exitType} TPs:${t.tpHits.join(',')||'none'} dur:${t.durationMinutes||'?'}m | ${lt?.strategy||'???'} | regime:${lt?.regime||'?'}`);
    }
}
