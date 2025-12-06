import Chart from 'chart.js/auto';
import { calculateHeatPumpCycle } from './logic.js';

let myChart = null;

/**
 * 绘制或更新性能曲线图
 * @param {number} currentTempOut 用户输入的当前室外温度
 * @param {number} currentSupplyTemp 用户输入的供水温度
 * @param {object} Module CoolProp 实例
 */
export function updateChart(currentTempOut, currentSupplyTemp, Module) {
  const ctx = document.getElementById('performance-chart');
  
  // 1. 生成曲线数据 (从 -20度 到 +20度，每隔 2度 算一次)
  const labels = [];
  const dataCOP = [];
  
  for (let temp = -20; temp <= 20; temp += 2) {
    labels.push(temp);
    // 复用您的核心计算逻辑
    const res = calculateHeatPumpCycle(temp, currentSupplyTemp, Module);
    // 如果算出来有错(比如温度太低停机)，就给 null，图表会断开
    dataCOP.push(res.error ? null : res.cop);
  }

  // 2. 如果图表已存在，先销毁它(否则鼠标悬停会闪烁)
  if (myChart) {
    myChart.destroy();
  }

  // 3. 创建新图表
  myChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels: labels,
      datasets: [
        {
          label: `COP 趋势 (供水 ${currentSupplyTemp}°C)`,
          data: dataCOP,
          borderColor: 'rgb(59, 130, 246)', // 蓝色
          backgroundColor: 'rgba(59, 130, 246, 0.1)',
          tension: 0.4, // 曲线平滑度
          fill: true
        },
        {
            label: '当前工况点',
            data: labels.map(t => t === parseInt(currentTempOut) ? calculateHeatPumpCycle(t, currentSupplyTemp, Module).cop : null),
            pointRadius: 6,
            pointBackgroundColor: 'red',
            showLine: false // 这一层不画线，只画点
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        x: { title: { display: true, text: '室外环境温度 (°C)' } },
        y: { title: { display: true, text: '性能系数 (COP)' }, beginAtZero: false }
      },
      plugins: {
        tooltip: {
            mode: 'index',
            intersect: false
        }
      }
    }
  });
}