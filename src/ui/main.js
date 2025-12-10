// src/ui/main.js
import '../style.css'; 
import { store } from '../state/store.js';
import { System } from '../models/System.js';
import { updatePerformanceChart } from './charts.js';
import { renderSystemDiagram } from './diagram.js'; 
import { MODES, TOPOLOGY, STRATEGIES } from '../core/constants.js';
import { getSatTempFromPressure, convertSteamTonsToKW } from '../core/physics.js';

// === Unit Options for Advanced Parameters (FIXED: Unit Conversion) ===
const CAL_UNIT_OPTIONS = [
    // MJ/kg is arbitrary base (Factor=1.0)
    { value: 'MJ/kg', text: 'MJ/kg', factor: 1.0 },
    { value: 'kWh/kg', text: 'kWh/kg', factor: 0.277778 }, // 1 kWh ≈ 3.6 MJ
    { value: 'MJ/m3', text: 'MJ/m³', factor: 1.0 },
    { value: 'kWh/m3', text: 'kWh/m³', factor: 0.277778 }
];

const CO2_UNIT_OPTIONS = [
    // kgCO2/unit is arbitrary base (Factor=1.0)
    { value: 'kgCO2/unit', text: 'kg/Unit', factor: 1.0 }, // kg CO2 / kg Fuel or m3 Fuel
    { value: 'kgCO2/kWh', text: 'kg/kWh', factor: 1.0 } // kg CO2 / kWh Heat Output
];

function populateUnitSelect(selectEl, options, currentUnit) {
    if (!selectEl) return;
    selectEl.innerHTML = '';
    options.forEach(opt => {
        const option = document.createElement('option');
        option.value = opt.value;
        option.innerText = opt.text;
        if (opt.value === currentUnit) {
             option.selected = true;
        }
        selectEl.appendChild(option);
    });
}

function findUnitFactor(unit, options) {
    const opt = options.find(o => o.value === unit);
    return opt ? opt.factor : 1.0;
}


// === 1. DOM 元素映射 ===
const ui = {
    topo: document.getElementById('select-topology'),
    btnWater: document.getElementById('btn-mode-water'),
    btnSteam: document.getElementById('btn-mode-steam'),
    inpMode: document.getElementById('input-target-mode'),
    
    panelStd: document.getElementById('panel-input-standard'),
    panelRec: document.getElementById('panel-input-recovery'),
    boxTargetStd: document.getElementById('box-target-std'),
    boxSteamStrat: document.getElementById('box-steam-strategy'),
    
    inpSource: document.getElementById('input-temp-source'),
    inpFlueIn: document.getElementById('input-flue-temp-in'),
    inpFlueOut: document.getElementById('input-flue-temp-out'),
    inpLoadIn: document.getElementById('input-load-in'),
    inpLoadOut: document.getElementById('input-load-out'),
    selSteamStrat: document.getElementById('select-steam-strategy'),
    selRecType: document.getElementById('select-recovery-type'),
    inpPefElec: document.getElementById('inp-pef-elec'),
    
    // [v9.1 新增] 过量空气系数输入框
    inpExcessAir: document.getElementById('inp-excess-air'),

    inpTarget: document.getElementById('input-target-val'),
    lblTarget: document.getElementById('label-target-val'),
    unitTarget: document.getElementById('unit-target-val'),
    resSatTemp: document.getElementById('res-sat-temp'),
    boxSteamInfo: document.getElementById('steam-info-box'),

    resPayback: document.getElementById('res-payback'),
    selPerfection: document.getElementById('sel-perfection'),
    inpPerfectionCustom: document.getElementById('inp-perfection-custom'),
    boxPerfCustom: document.getElementById('box-perf-custom'),
    chkManualCop: document.getElementById('chk-manual-cop'),
    inpManualCop: document.getElementById('inp-manual-cop'),
    inpFuelCal: document.getElementById('inp-fuel-cal'),
    selUnitCal: document.getElementById('sel-unit-cal'),
    inpFuelCo2: document.getElementById('inp-fuel-co2'),
    selUnitCo2: document.getElementById('sel-unit-co2'),
    inpFuelEff: document.getElementById('inp-fuel-eff'),
    
    inpLoad: document.getElementById('input-load'),
    inpLoadTon: document.getElementById('input-load-ton'),
    selLoadUnit: document.getElementById('select-load-unit'),
    valLoadConv: document.getElementById('val-load-converted'),
    infoLoadConv: document.getElementById('info-load-converted'),
    unitLoadDisplay: document.getElementById('unit-load-display'), 

    btnCalc: document.getElementById('btn-calculate'),

    resCop: document.getElementById('res-cop'),
    resLift: document.getElementById('res-lift'),
    resPer: document.getElementById('res-per'),
    resCo2Red: document.getElementById('res-co2-red'),
    
    resCost: document.getElementById('res-cost'),         
    resUnitCost: document.getElementById('res-unit-cost'), 
    resAnnualSave: document.getElementById('res-annual-save'), 
    
    valCapTotal: document.getElementById('val-cap-total'),
    valCapTon: document.getElementById('val-cap-ton'),
    valCapBreakdown: document.getElementById('val-cap-breakdown'),
    
    // 选型单相关的 DOM 元素
    btnGenReq: document.getElementById('btn-gen-req'),
    modalReq: document.getElementById('modal-requisition'),
    btnCloseModal: document.getElementById('btn-close-modal'),
    btnCopyReq: document.getElementById('btn-copy-req'),
    reqSourceType: document.getElementById('req-source-type'),
    reqSourceIn: document.getElementById('req-source-in'),
    reqSourceOut: document.getElementById('req-source-out'),
    reqLoadType: document.getElementById('req-load-type'),
    reqLoadIn: document.getElementById('req-load-in'),
    reqLoadOut: document.getElementById('req-load-out'),
    reqCapacity: document.getElementById('req-capacity'),

    log: document.getElementById('system-log')
};

// 暂存选型数据
let currentReqData = null;

// === 2. 事件绑定 ===
function bindEvents() {
    ui.topo.addEventListener('change', (e) => {
        const newTopo = e.target.value;
        const updates = { topology: newTopo };
        if (newTopo === TOPOLOGY.PARALLEL) updates.sourceTemp = -5.0;
        else if (newTopo === TOPOLOGY.COUPLED) updates.sourceTemp = 35.0;
        store.setState(updates);
    });

    ui.btnWater.addEventListener('click', () => {
        store.setState({ 
            mode: MODES.WATER, targetTemp: 60.0, loadIn: 50.0, loadOut: 70.0
        });
    });

    ui.btnSteam.addEventListener('click', () => {
        store.setState({ 
            mode: MODES.STEAM, targetTemp: 0.5, loadIn: 20.0, loadOut: 90.0
        });
    });

    const bindInput = (el, key, isFloat = true) => {
        if(!el) return;
        el.addEventListener('input', (e) => {
            const val = isFloat ? parseFloat(e.target.value) : e.target.value;
            store.setState({ [key]: val });
        });
    };

    bindInput(ui.inpSource, 'sourceTemp');
    bindInput(ui.inpFlueIn, 'flueIn');
    bindInput(ui.inpFlueOut, 'flueOut');
    bindInput(ui.inpLoadIn, 'loadIn');
    bindInput(ui.inpLoadOut, 'loadOut');
    bindInput(ui.inpTarget, 'targetTemp');
    bindInput(ui.inpLoad, 'loadValue'); // 直接绑定 kW 值
    // ui.inpLoadTon 不再直接绑定 loadValueTons，而是通过 input 事件处理

    bindInput(ui.inpPefElec, 'pefElec');
    
    // [v9.1 新增] 绑定过量空气系数
    bindInput(ui.inpExcessAir, 'excessAir');
    
    if(ui.selSteamStrat) ui.selSteamStrat.addEventListener('change', (e) => store.setState({ steamStrategy: e.target.value }));
    if(ui.selRecType) ui.selRecType.addEventListener('change', (e) => store.setState({ recoveryType: e.target.value }));

    // 【高级参数绑定修复】
    bindInput(ui.inpFuelCal, 'fuelCalValue');
    bindInput(ui.inpFuelCo2, 'fuelCo2Value');
    bindInput(ui.inpFuelEff, 'boilerEff');
    bindInput(ui.inpPefElec, 'pefElec');
    bindInput(ui.inpPerfectionCustom, 'perfectionDegree');
    
    // 热力完善度选择
    ui.selPerfection.addEventListener('change', (e) => {
        const val = e.target.value;
        if (val === 'CUSTOM') {
            ui.boxPerfCustom.classList.remove('hidden');
        } else {
            ui.boxPerfCustom.classList.add('hidden');
            store.setState({ perfectionDegree: parseFloat(val) });
        }
    });
    
    // LHV 单位切换 (自动转换值)
    ui.selUnitCal.addEventListener('change', (e) => {
        const newUnit = e.target.value;
        const currentState = store.getState();
        const oldUnit = currentState.fuelCalUnit;
        
        const oldFactor = findUnitFactor(oldUnit, CAL_UNIT_OPTIONS);
        const newFactor = findUnitFactor(newUnit, CAL_UNIT_OPTIONS);
        const ratio = oldFactor / newFactor;
        
        const convertedValue = currentState.fuelCalValue * ratio;
        
        store.setState({ 
            fuelCalValue: convertedValue, 
            fuelCalUnit: newUnit 
        });
    });
    
    // CO2 单位切换 (只更新单位)
    ui.selUnitCo2.addEventListener('change', (e) => {
        store.setState({ fuelCo2Unit: e.target.value });
    });
    
    // COP 锁定
    const manualCopInputHandler = (e) => store.setState({ manualCop: parseFloat(e.target.value) });
    const manualCopChangeHandler = (e) => {
        const isManual = e.target.checked;
        ui.inpManualCop.disabled = !isManual;
        store.setState({ isManualCop: isManual });
    };
    if (ui.chkManualCop) ui.chkManualCop.addEventListener('change', manualCopChangeHandler);
    if (ui.inpManualCop) ui.inpManualCop.addEventListener('input', manualCopInputHandler);
    
    // 【单位切换逻辑修复】
    ui.selLoadUnit.addEventListener('change', (e) => {
        const unit = e.target.value;
        store.setState({ loadUnit: unit }); // 仅更新单位，数值同步交给 store.subscribe
    });

    // 【蒸吨输入特殊处理】
    ui.inpLoadTon.addEventListener('input', (e) => {
        const tons = parseFloat(e.target.value) || 0;
        const kw = convertSteamTonsToKW(tons);
        // 关键：同时更新 loadValue（kW）和 loadValueTons（t/h）
        store.setState({ loadValue: kw, loadValueTons: tons }); 
    });

    ui.btnCalc.addEventListener('click', () => {
        runSimulation();
    });

    // 选型单按钮事件
    if (ui.btnGenReq) {
        ui.btnGenReq.addEventListener('click', () => {
            if (!currentReqData) {
                alert('请先运行仿真以生成数据');
                return;
            }
            ui.reqSourceType.innerText = currentReqData.sourceType;
            ui.reqSourceIn.innerText = currentReqData.sourceIn.toFixed(1);
            ui.reqSourceOut.innerText = currentReqData.sourceOut.toFixed(1);
            ui.reqLoadType.innerText = currentReqData.loadType;
            ui.reqLoadIn.innerText = currentReqData.loadIn.toFixed(1);
            ui.reqLoadOut.innerText = currentReqData.loadOut.toFixed(1);
            ui.reqCapacity.innerText = currentReqData.capacity.toLocaleString(undefined, { maximumFractionDigits: 0 });
            
            ui.modalReq.classList.remove('hidden');
        });
    }

    if (ui.btnCloseModal) {
        ui.btnCloseModal.addEventListener('click', () => {
            ui.modalReq.classList.add('hidden');
        });
    }

    if (ui.btnCopyReq) {
        ui.btnCopyReq.addEventListener('click', () => {
            if (!currentReqData) return;
            const text = `【工业热泵选型参数】\n热源: ${currentReqData.sourceType}\n温度: ${currentReqData.sourceIn.toFixed(1)} -> ${currentReqData.sourceOut.toFixed(1)}°C\n负荷: ${currentReqData.loadType}\n温度: ${currentReqData.loadIn.toFixed(1)} -> ${currentReqData.loadOut.toFixed(1)}°C\n制热量: ${currentReqData.capacity.toFixed(0)} kW`;
            navigator.clipboard.writeText(text).then(() => {
                const originalText = ui.btnCopyReq.innerText;
                ui.btnCopyReq.innerText = "已复制!";
                setTimeout(() => ui.btnCopyReq.innerText = originalText, 2000);
            });
        });
    }
}

// === 3. 界面渲染 ===
store.subscribe((state) => {
    const { topology, mode, targetTemp, sourceTemp, recoveryType, loadUnit, loadValue, loadValueTons, fuelCalValue, fuelCalUnit, fuelCo2Value, fuelCo2Unit, perfectionDegree, isManualCop, manualCop } = state;

    if (ui.topo.value !== topology) ui.topo.value = topology;
    if (ui.selRecType && ui.selRecType.value !== recoveryType) ui.selRecType.value = recoveryType;

    if (document.activeElement !== ui.inpTarget) ui.inpTarget.value = targetTemp;
    if (document.activeElement !== ui.inpSource) ui.inpSource.value = sourceTemp;
    if (document.activeElement !== ui.inpLoadIn) ui.inpLoadIn.value = state.loadIn;
    if (document.activeElement !== ui.inpLoadOut) ui.inpLoadOut.value = state.loadOut;
    
    // [v9.1] 渲染过量空气系数
    if (ui.inpExcessAir && document.activeElement !== ui.inpExcessAir) {
        ui.inpExcessAir.value = state.excessAir;
    }
    
    // 【高级参数同步修复】
    if (document.activeElement !== ui.inpFuelCal) ui.inpFuelCal.value = fuelCalValue.toFixed(2);
    populateUnitSelect(ui.selUnitCal, CAL_UNIT_OPTIONS, fuelCalUnit);
    
    if (document.activeElement !== ui.inpFuelCo2) ui.inpFuelCo2.value = fuelCo2Value.toFixed(3);
    populateUnitSelect(ui.selUnitCo2, CO2_UNIT_OPTIONS, fuelCo2Unit);
    
    if (document.activeElement !== ui.inpFuelEff) ui.inpFuelEff.value = state.boilerEff.toFixed(2);
    
    // 完善度同步
    if (ui.selPerfection) {
        const perfStr = perfectionDegree.toFixed(2);
        const isCustom = ui.selPerfection.value === 'CUSTOM' || (!['0.40', '0.45', '0.55'].includes(perfStr));
        
        if (isCustom) {
            ui.selPerfection.value = 'CUSTOM';
            ui.boxPerfCustom.classList.remove('hidden');
            if (document.activeElement !== ui.inpPerfectionCustom) ui.inpPerfectionCustom.value = perfStr;
        } else {
            ui.selPerfection.value = perfStr;
            ui.boxPerfCustom.classList.add('hidden');
        }
    }
    
    // COP 锁定同步
    ui.chkManualCop.checked = isManualCop;
    ui.inpManualCop.disabled = !isManualCop;
    if (document.activeElement !== ui.inpManualCop) ui.inpManualCop.value = manualCop;
    

    const isSteam = (mode === MODES.STEAM);
    ui.btnWater.className = !isSteam ? "flex-1 py-1.5 text-xs font-bold rounded-md shadow bg-white text-indigo-600 transition" : "flex-1 py-1.5 text-xs font-bold rounded-md text-slate-500 hover:text-slate-700 transition";
    ui.btnSteam.className = isSteam ? "flex-1 py-1.5 text-xs font-bold rounded-md shadow bg-white text-indigo-600 transition" : "flex-1 py-1.5 text-xs font-bold rounded-md text-slate-500 hover:text-slate-700 transition";

    if (topology === TOPOLOGY.RECOVERY) {
        ui.panelStd.classList.add('hidden');
        ui.boxTargetStd.classList.add('hidden');
        ui.panelRec.classList.remove('hidden');
        if (isSteam) ui.boxSteamStrat.classList.remove('hidden');
        else ui.boxSteamStrat.classList.add('hidden');
    } else {
        ui.panelRec.classList.add('hidden');
        ui.panelStd.classList.remove('hidden');
        ui.boxTargetStd.classList.remove('hidden');
        ui.boxSteamStrat.classList.add('hidden');
        
        const label = document.getElementById('label-source-temp');
        if (label) label.innerText = (topology === TOPOLOGY.PARALLEL) ? "室外干球温度" : "余热源温度";
    }

    if (isSteam) {
        ui.lblTarget.innerText = "目标饱和蒸汽压力";
        ui.unitTarget.innerText = "MPa(a)";
        ui.boxSteamInfo.classList.remove('hidden');
        ui.resSatTemp.innerText = `${getSatTempFromPressure(targetTemp)} °C`;
    } else {
        ui.lblTarget.innerText = "目标供水/回水温度";
        ui.unitTarget.innerText = "°C";
        ui.boxSteamInfo.classList.add('hidden');
    }
    
    // 【负荷单位同步与输入框切换】
    const isTon = (loadUnit === 'TON');
    ui.selLoadUnit.value = loadUnit; // 确保下拉框状态正确
    ui.unitLoadDisplay.innerText = loadUnit;

    if (isTon) {
        ui.inpLoad.classList.add('hidden');
        ui.inpLoadTon.classList.remove('hidden');
        ui.infoLoadConv.classList.remove('hidden');
        
        // 渲染蒸吨输入框的值
        if (document.activeElement !== ui.inpLoadTon) {
            ui.inpLoadTon.value = loadValueTons;
        }
        // 更新 kW 转换显示
        ui.valLoadConv.innerText = loadValue.toLocaleString(undefined, { maximumFractionDigits: 1 });
        
    } else { // KW 模式
        ui.inpLoad.classList.remove('hidden');
        ui.inpLoadTon.classList.add('hidden');
        ui.infoLoadConv.classList.add('hidden');
        
        // 渲染 kW 输入框的值
        if (document.activeElement !== ui.inpLoad) {
            ui.inpLoad.value = loadValue;
        }
    }
    
});

// === 4. 仿真运行 ===
function runSimulation() {
    const state = store.getState();
    log(`🚀 仿真启动... [${state.topology}] [α=${state.excessAir}]`);

    const sys = new System(state);
    const res = sys.simulate();

    if (res.error) {
        log(`❌ 错误: ${res.error}`, 'error');
        ui.resCop.innerText = "Err";
        
        if(ui.btnGenReq) {
            ui.btnGenReq.disabled = true;
            ui.btnGenReq.classList.add('opacity-50', 'cursor-not-allowed');
        }
        return;
    }

    currentReqData = res.reqData;
    
    if(ui.btnGenReq) {
        ui.btnGenReq.disabled = false;
        ui.btnGenReq.classList.remove('opacity-50', 'cursor-not-allowed');
    }

    ui.resCop.innerText = res.cop.toFixed(2);
    ui.resLift.innerText = (res.lift || 0).toFixed(1);
    
    if (res.per !== undefined) ui.resPer.innerText = res.per.toFixed(2);
    else ui.resPer.innerText = "--";

    if (res.annualSaving !== undefined) {
        ui.resCost.innerText = res.costPerHour.toFixed(1);
        const unitCost = res.costPerHour / state.loadValue;
        if (ui.resUnitCost) ui.resUnitCost.innerText = unitCost.toFixed(3);
        if (ui.resAnnualSave) {
            ui.resAnnualSave.innerText = res.annualSaving > 10000 
                ? `${(res.annualSaving/10000).toFixed(1)}万` 
                : res.annualSaving.toFixed(0);
        }
        if (ui.resPayback) ui.resPayback.innerText = (res.payback > 20) ? ">20" : res.payback.toFixed(1);
        if (ui.resCo2Red) ui.resCo2Red.innerText = res.co2ReductionRate.toFixed(1);
    }

    if (res.recoveredHeat) {
        // [修正] 总产能应使用 loadValue，因为这是系统的设计目标
        const totalCap = state.loadValue; 
        ui.valCapTotal.innerText = totalCap.toFixed(0);
        
        if (res.tonData) {
            ui.valCapTon.innerText = res.tonData.total.toFixed(1);
            ui.valCapBreakdown.innerHTML = `
                <div class="flex items-center gap-3 text-[10px] sm:text-xs">
                    <div class="flex items-center gap-1">
                        <span class="w-2 h-2 rounded-full bg-slate-300"></span>
                        <span class="text-slate-500 font-medium">Blr: <b class="text-slate-700">${res.tonData.boiler.toFixed(1)}</b></span>
                    </div>
                    <div class="flex items-center gap-1">
                        <span class="w-2 h-2 rounded-full bg-emerald-500"></span>
                        <span class="text-emerald-600 font-medium">HP: <b class="text-emerald-700">${res.tonData.hp.toFixed(1)}</b> t/h</span>
                    </div>
                </div>`;
        } else {
            ui.valCapBreakdown.innerHTML = '';
        }
    }

    updatePerformanceChart(state);
    
    const displaySupplyT = (state.mode === MODES.STEAM) 
        ? getSatTempFromPressure(state.targetTemp) 
        : state.targetTemp;

    renderSystemDiagram('diagram-container', {
        topology: state.topology,
        tSource: state.sourceTemp,
        tDisplaySource: state.topology === TOPOLOGY.RECOVERY ? state.flueIn : state.sourceTemp,
        tSupply: displaySupplyT,
        recoveredKW: res.recoveredHeat || 0
    });

    log(`✅ 计算完成. COP=${res.cop}`, 'eco');
}

function log(msg, type = 'info') {
    const time = new Date().toLocaleTimeString('en-GB');
    let clr = 'text-green-400';
    if (type === 'error') clr = 'text-red-400';
    ui.log.innerHTML += `<div class="${clr} border-l-2 border-transparent pl-1"><span class="opacity-50">[${time}]</span> ${msg}</div>`;
    ui.log.scrollTop = ui.log.scrollHeight;
}

bindEvents();

// 初始化高级参数的默认值和单位
const initialState = store.getState();
const initialAdvancedState = {
    fuelCalValue: parseFloat(ui.inpFuelCal.value) || 10.0,
    fuelCalUnit: CAL_UNIT_OPTIONS[0].value, 
    fuelCo2Value: parseFloat(ui.inpFuelCo2.value) || 0.202,
    fuelCo2Unit: CO2_UNIT_OPTIONS[0].value, 
    perfectionDegree: parseFloat(ui.selPerfection.value) || 0.45,
    boilerEff: parseFloat(ui.inpFuelEff.value) || 0.92,
    manualCop: parseFloat(ui.inpManualCop.value) || 3.5,
    isManualCop: ui.chkManualCop.checked || false
};
store.setState(initialAdvancedState);
// 首次运行时，确保 loadValueTons 具有一个初始的反算值
if (initialState.loadUnit === 'KW' && initialState.loadValue && !initialState.loadValueTons) {
    const tons = initialState.loadValue / 700; // 反算初始蒸吨
    store.setState({ loadValueTons: tons });
}

if (ui.selRecType) store.setState({ recoveryType: ui.selRecType.value });
store.notify(store.getState());