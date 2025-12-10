// src/state/store.js
import { TOPOLOGY, MODES, STRATEGIES, RECOVERY_TYPES } from '../core/constants.js';

// 初始状态定义
const initialState = {
    // 系统架构
    topology: TOPOLOGY.RECOVERY, // 默认方案 C
    
    // 核心参数
    mode: MODES.WATER,
    steamStrategy: STRATEGIES.PREHEAT,
    recoveryType: RECOVERY_TYPES.ABS, // 默认吸收式
    
    // [v9.1 新增] 燃烧参数
    excessAir: 1.20,         // 过量空气系数 (Alpha), 默认 1.2
    
    // 温度参数 (C)
    sourceTemp: 35.0,        // 方案A/B 环境温度
    targetTemp: 60.0,        // 目标供水/饱和温度
    
    // 余热回收专用
    flueIn: 130.0,
    flueOut: 40.0,
    loadIn: 20.0,            // 补水/回水温度
    loadOut: 90.0,           // 预热目标/供水温度

    // 高级参数: LHV, CO2 因子 (手动覆盖)
    fuelCalValue: 10.0,      // LHV value (index.html default)
    fuelCalUnit: 'MJ/kg',    // Placeholder unit
    fuelCo2Value: 0.202,     // CO2 factor value (index.html default)
    fuelCo2Unit: 'kgCO2/unit', // Placeholder unit
    
    // 负荷与效率
    loadValue: 2000.0,       // kW
    loadUnit: 'KW',          // KW | TON
    loadValueTons: 2000.0 / 700.0, // 初始蒸吨值
    perfectionDegree: 0.45,  // 热力完善度
    manualCop: 3.5,            // 手动COP值
    isManualCop: false,      // 是否启用手动COP
    
    // 经济性
    fuelType: 'NATURAL_GAS',
    elecPrice: 0.75,
    fuelPrice: 3.80,
    annualHours: 6000,
    boilerEff: 0.92,
    
    // 造价参数
    capexHP: 2500,
    capexBase: 200
};

class Store {
    constructor() {
        this.state = { ...initialState };
        this.listeners = new Set();
    }

    /**
     * 获取当前状态快照
     */
    getState() {
        return this.state;
    }

    /**
     * 更新状态并通知订阅者
     * @param {Object} partialState - 部分更新的状态对象
     */
    setState(partialState) {
        const prevState = { ...this.state };
        this.state = { ...this.state, ...partialState };
        
        // 简单 Diff，如果有变化才通知
        // (此处简化处理，实际只要调用就通知，确保 UI 响应)
        this.notify(prevState);
    }

    /**
     * 订阅状态变化
     * @param {Function} listener - 回调函数 (newState, prevState) => void
     * @returns {Function} unsubscribe - 取消订阅函数
     */
    subscribe(listener) {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }

    /**
     * 触发所有监听器
     */
    notify(prevState) {
        this.listeners.forEach(listener => listener(this.state, prevState));
    }
    
    /**
     * 重置为初始状态
     */
    reset() {
        this.setState(initialState);
    }
}

// 导出单例，确保全应用共享同一个 Store
export const store = new Store();