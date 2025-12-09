// src/main.js - v7.4 Stable Fix Controller

import './style.css'
import { 
    calculateProcessCycle, 
    calculateHybridStrategy, 
    getSatTempFromPressure, 
    SYSTEM_CONFIG, 
    FuelDatabase,
    UNIT_CONVERTERS 
} from './logic.js';
import { updateChart } from './chartHelper.js';
import { renderSystemDiagram } from './diagram.js';

// --- 1. DOM 元素获取 ---
const dom = {
    // 基础控制
    topo: document.getElementById('select-topology'),
    btnWater: document.getElementById('btn-mode-water'),
    btnSteam: document.getElementById('btn-mode-steam'),
    inpMode: document.getElementById('input-target-mode'),
    
    // 面板
    panelStd: document.getElementById('panel-input-standard'),
    panelRec: document.getElementById('panel-input-recovery'),
    
    // 输入
    lblSource: document.getElementById('label-source-temp'),
    inpSource: document.getElementById('input-temp-source'),
    inpFlueIn: document.getElementById('input-flue-temp-in'),
    inpFlueOut: document.getElementById('input-flue-temp-out'),
    selRecType: document.getElementById('select-recovery-type'),
    lblTarget: document.getElementById('label-target-val'),
    inpTarget: document.getElementById('input-target-val'),
    unitTarget: document.getElementById('unit-target-val'),
    boxSteamInfo: document.getElementById('steam-info-box'),
    resSatTemp: document.getElementById('res-sat-temp'),
    inpLoad: document.getElementById('input-load'),
    inpAnnualHours: document.getElementById('input-annual-hours'),
    
    // 经济
    selFuel: document.getElementById('select-fuel'),
    inpElecPrice: document.getElementById('input-elec-price'),
    inpFuelPrice: document.getElementById('input-fuel-price'),
    lblFuelUnit: document.getElementById('label-fuel-unit'),
    inpCapexHP: document.getElementById('inp-capex-hp'),
    inpCapexBase: document.getElementById('inp-capex-base'),
    
    // 高级
    selPerfection: document.getElementById('sel-perfection'),
    boxPerfCustom: document.getElementById('box-perf-custom'),
    inpPerfCustom: document.getElementById('inp-perfection-custom'),
    chkManualCop: document.getElementById('chk-manual-cop'),
    inpManualCop: document.getElementById('inp-manual-cop'),
    inpPefElec: document.getElementById('inp-pef-elec'),
    
    inpFuelCal: document.getElementById('inp-fuel-cal'),
    selUnitCal: document.getElementById('sel-unit-cal'), 
    inpFuelCo2: document.getElementById('inp-fuel-co2'),
    selUnitCo2: document.getElementById('sel-unit-co2'),
    inpFuelEff: document.getElementById('inp-fuel-eff'),
    
    // 结果
    btnCalc: document.getElementById('btn-calculate'),
    lblRes2: document.getElementById('lbl-res-2'),
    unitRes2: document.getElementById('unit-res-2'),
    lblRes3: document.getElementById('lbl-res-3'),
    descRes3: document.getElementById('desc-res-3'),
    resCop: document.getElementById('res-cop'),
    resLift: document.getElementById('res-lift'),      
    resPratio: document.getElementById('res-pratio'), // 可能为空
    resPer: document.getElementById('res-per'),
    resCo2Red: document.getElementById('res-co2-red'),   
    resCost: document.getElementById('res-cost'),
    resUnitCost: document.getElementById('res-unit-cost'), 
    resAnnualSave: document.getElementById('res-annual-save'), 
    resPayback: document.getElementById('res-payback'),
    log: document.getElementById('system-log')
};

function log(msg, type = 'info') {
    const time = new Date().toLocaleTimeString('en-GB');
    let clr = 'text-green-400';
    if (type === 'error') clr = 'text-red-400';
    if (type === 'warn') clr = 'text-yellow-400';
    if (type === 'eco') clr = 'text-emerald-300 font-bold';
    if (dom.log) {
        dom.log.innerHTML += `<div class="${clr} border-l-2 border-transparent pl-1 hover:bg-slate-800"><span class="opacity-50">[${time}]</span> ${msg}</div>`;
        dom.log.scrollTop = dom.log.scrollHeight;
    }
}

function updateUnitOptions(fuelKey) {
    const db = FuelDatabase[fuelKey];
    const baseUnit = db.unit; 
    const calOpts = [
        { val: 'kWh', txt: `kWh/${baseUnit}` },
        { val: 'MJ',  txt: `MJ/${baseUnit}` },
        { val: 'kcal', txt: `kcal/${baseUnit}` },
        { val: 'GJ',  txt: `GJ/${baseUnit}` }
    ];
    dom.selUnitCal.innerHTML = calOpts.map(o => `<option value="${o.val}">${o.txt}</option>`).join('');
    dom.selUnitCal.value = 'kWh';
    const co2Opts = [
        { val: 'kg/kWh', txt: `kg/kWh` },
        { val: 'kg/MJ',  txt: `kg/MJ` },
        { val: 'kg/kcal', txt: `kg/kcal` }
    ];
    dom.selUnitCo2.innerHTML = co2Opts.map(o => `<option value="${o.val}">${o.txt}</option>`).join('');
    dom.selUnitCo2.value = 'kg/kWh';
}

dom.selFuel.addEventListener('change', (e) => {
    const key = e.target.value;
    const db = FuelDatabase[key];
    dom.lblFuelUnit.innerText = `/${db.unit}`;
    const priceMap = { 'NATURAL_GAS': 3.8, 'COAL': 1.2, 'DIESEL': 7.5, 'BIOMASS': 1.0, 'STEAM_PIPE': 220, 'ELECTRICITY': 0.75 };
    dom.inpFuelPrice.value = priceMap[key] || 1.0;
    const capexMap = { 'NATURAL_GAS': 200, 'COAL': 400, 'ELECTRICITY': 150, 'BIOMASS': 500, 'STEAM_PIPE': 50, 'DIESEL': 250 };
    dom.inpCapexBase.value = capexMap[key] || 200;
    updateUnitOptions(key);
    dom.inpFuelCal.value = db.calorificValue; 
    dom.inpFuelCo2.value = db.co2Factor;
    dom.inpFuelEff.value = db.efficiency;
    prevCalUnit = 'kWh'; prevCo2Unit = 'kg/kWh';
    log(`CFG: 燃料切换至 [${db.name}]`);
});

let prevCalUnit = 'kWh';
dom.selUnitCal.addEventListener('focus', () => { prevCalUnit = dom.selUnitCal.value; });
dom.selUnitCal.addEventListener('change', () => {
    const val = parseFloat(dom.inpFuelCal.value);
    const fromFactor = UNIT_CONVERTERS[prevCalUnit] || 1.0;
    const toFactor = UNIT_CONVERTERS[dom.selUnitCal.value] || 1.0;
    const newVal = val * (toFactor / fromFactor);
    dom.inpFuelCal.value = parseFloat(newVal.toPrecision(5));
    prevCalUnit = dom.selUnitCal.value;
});

let prevCo2Unit = 'kg/kWh';
dom.selUnitCo2.addEventListener('focus', () => { prevCo2Unit = dom.selUnitCo2.value; });
dom.selUnitCo2.addEventListener('change', () => {
    const val = parseFloat(dom.inpFuelCo2.value);
    const fromBase = prevCo2Unit.split('/')[1];
    const toBase = dom.selUnitCo2.value.split('/')[1];
    const fromFactor = UNIT_CONVERTERS[fromBase] || 1.0;
    const toFactor = UNIT_CONVERTERS[toBase] || 1.0;
    const newVal = val * (fromFactor / toFactor);
    dom.inpFuelCo2.value = parseFloat(newVal.toPrecision(5));
    prevCo2Unit = dom.selUnitCo2.value;
});

dom.topo.addEventListener('change', (e) => {
    const topo = e.target.value;
    if (topo === 'RECOVERY') {
        dom.panelStd.classList.add('hidden');
        dom.panelRec.classList.remove('hidden');
        dom.lblRes2.innerText = "冷凝水回收 (Water)";
        dom.unitRes2.innerText = "t/h";
        dom.lblRes3.innerText = "系统综合效率";
        dom.descRes3.innerText = "System + HP";
    } else {
        dom.panelStd.classList.remove('hidden');
        dom.panelRec.classList.add('hidden');
        dom.lblRes2.innerText = "系统温升 (Lift)";
        dom.unitRes2.innerText = "K";
        dom.lblRes3.innerText = "压缩比 (P.Ratio)";
        dom.descRes3.innerText = "Est. Ratio";
        if (topo === 'COUPLED') {
            dom.lblSource.innerText = "工业余热/废热温度";
            dom.inpSource.value = SYSTEM_CONFIG.wasteHeatTemp;
        } else {
            dom.lblSource.innerText = "室外干球温度";
            dom.inpSource.value = "-5";
        }
    }
    updateDiagram();
});

function setTargetMode(mode) {
    dom.inpMode.value = mode;
    const isSteam = (mode === 'STEAM');
    dom.btnSteam.className = isSteam ? "flex-1 py-1.5 text-xs font-bold rounded-md shadow bg-white text-indigo-600 transition" : "flex-1 py-1.5 text-xs font-bold rounded-md text-slate-500 hover:text-slate-700 transition";
    dom.btnWater.className = !isSteam ? "flex-1 py-1.5 text-xs font-bold rounded-md shadow bg-white text-indigo-600 transition" : "flex-1 py-1.5 text-xs font-bold rounded-md text-slate-500 hover:text-slate-700 transition";
    if (isSteam) {
        dom.lblTarget.innerText = "目标饱和蒸汽压力";
        dom.inpTarget.value = "0.5"; dom.inpTarget.step = "0.1";
        dom.unitTarget.innerText = "MPa(a)";
        dom.boxSteamInfo.classList.remove('hidden');
        updateSatTempPreview();
    } else {
        dom.lblTarget.innerText = "目标供水/回水温度";
        dom.inpTarget.value = "60"; dom.inpTarget.step = "1";
        dom.unitTarget.innerText = "°C";
        dom.boxSteamInfo.classList.add('hidden');
    }
}
dom.btnWater.addEventListener('click', () => setTargetMode('WATER'));
dom.btnSteam.addEventListener('click', () => setTargetMode('STEAM'));

dom.inpTarget.addEventListener('input', () => {
    if (dom.inpMode.value === 'STEAM') updateSatTempPreview();
});
function updateSatTempPreview() {
    const p = parseFloat(dom.inpTarget.value);
    const t = getSatTempFromPressure(p);
    dom.resSatTemp.innerText = `${t} °C`;
}

dom.selPerfection.addEventListener('change', (e) => {
    e.target.value === 'CUSTOM' ? dom.boxPerfCustom.classList.remove('hidden') : dom.boxPerfCustom.classList.add('hidden');
});
dom.chkManualCop.addEventListener('change', (e) => {
    dom.inpManualCop.disabled = !e.target.checked;
    e.target.checked ? dom.inpManualCop.classList.replace('bg-slate-100','bg-white') : dom.inpManualCop.classList.replace('bg-white','bg-slate-100');
});

dom.btnCalc.addEventListener('click', () => {
    const topo = dom.topo.value;
    const mode = dom.inpMode.value;
    const srcT = parseFloat(dom.inpSource.value);
    const tgtVal = parseFloat(dom.inpTarget.value);
    
    let perfDegree = (dom.selPerfection.value === 'CUSTOM') ? parseFloat(dom.inpPerfCustom.value) : parseFloat(dom.selPerfection.value);
    const isManualCop = dom.chkManualCop.checked;
    const manualCopVal = isManualCop ? parseFloat(dom.inpManualCop.value) : 0;
    
    log(`RUN: 仿真启动... [Topo: ${topo}]`);

    const cycle = calculateProcessCycle({ 
        mode, sourceTemp: srcT, targetVal: tgtVal, perfectionDegree: perfDegree 
    });
    
    if (cycle.error) {
        log(cycle.error, 'error');
        dom.resCop.innerText = "Err";
        return;
    }

    const strat = calculateHybridStrategy({
        loadKW: parseFloat(dom.inpLoad.value),
        cop: cycle.cop,
        manualCop: manualCopVal,
        elecPrice: parseFloat(dom.inpElecPrice.value),
        fuelPrice: parseFloat(dom.inpFuelPrice.value),
        fuelTypeKey: dom.selFuel.value,
        topology: topo,
        customCalorific: parseFloat(dom.inpFuelCal.value),
        calUnit: dom.selUnitCal.value,
        customCo2: parseFloat(dom.inpFuelCo2.value),
        co2Unit: dom.selUnitCo2.value,
        customEfficiency: parseFloat(dom.inpFuelEff.value),
        annualHours: parseFloat(dom.inpAnnualHours.value),
        tExhaustIn: parseFloat(dom.inpFlueIn.value),
        tExhaustOut: parseFloat(dom.inpFlueOut.value),
        recoveryType: dom.selRecType.value,
        targetWaterTemp: (mode === 'STEAM' ? getSatTempFromPressure(tgtVal) : tgtVal),
        capexHP: parseFloat(dom.inpCapexHP.value),
        capexBase: parseFloat(dom.inpCapexBase.value),
        pefElec: parseFloat(dom.inpPefElec.value)
    });

    const displayCop = (isManualCop && manualCopVal > 0) ? manualCopVal : cycle.cop;
    dom.resCop.innerText = displayCop;
    dom.resCo2Red.innerText = strat.co2Reduction.toFixed(1);
    dom.resPer.innerText = (strat.per > 0 && strat.per < 100) ? strat.per : "--";
    
    if (topo === 'RECOVERY') {
        dom.resLift.innerText = strat.waterRecovery > 0 ? strat.waterRecovery.toFixed(2) : "0.0"; 
        // 使用 res-pratio 占位符显示综合效率，或者忽略
        if (dom.resPratio) {
            dom.resPratio.innerText = (strat.hpRatio > 0) ? ((parseFloat(dom.inpFuelEff.value) * (1 + strat.hpRatio/100)).toFixed(2)) : dom.inpFuelEff.value;
        }
    } else {
        dom.resLift.innerText = cycle.lift.toFixed(1);
        if (dom.resPratio) dom.resPratio.innerText = cycle.pRatio.toFixed(1);
    }
    
    dom.resCost.innerText = strat.cost.toFixed(1);
    dom.resUnitCost.innerText = strat.unitCost.toFixed(3);
    
    const annual = strat.annualSaving;
    dom.resAnnualSave.innerText = annual > 10000 ? `${(annual/10000).toFixed(1)}万` : annual.toFixed(0);
    
    if (strat.paybackPeriod > 0 && strat.paybackPeriod < 20) {
        dom.resPayback.innerText = strat.paybackPeriod;
    } else {
        dom.resPayback.innerText = "--";
    }
    
    updateChart(topo, mode, srcT, tgtVal, perfDegree);
    updateDiagram();
    
    if (strat.hpRatio > 0) { 
        log(`✅ [结果] ${strat.mode}`, 'eco');
        log(`📊 ROI: ${strat.paybackPeriod}年 | PER: ${strat.per}`, 'info');
    }
});

function updateDiagram() {
    renderSystemDiagram('diagram-container', {
        topology: dom.topo.value,
        tSource: parseFloat(dom.inpSource.value),
        tDisplaySource: dom.topo.value === 'RECOVERY' ? parseFloat(dom.inpFlueIn.value) : parseFloat(dom.inpSource.value),
        tSupply: dom.inpMode.value === 'STEAM' ? getSatTempFromPressure(parseFloat(dom.inpTarget.value)) : parseFloat(dom.inpTarget.value)
    });
}

setTargetMode('WATER');
dom.selFuel.dispatchEvent(new Event('change'));
updateDiagram();