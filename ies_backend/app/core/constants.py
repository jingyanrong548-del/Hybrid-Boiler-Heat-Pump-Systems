# app/core/constants.py

# === 移植自 src/core/constants.js ===
# 燃料数据库 (Single Source of Truth)
FUEL_DB = {
    'NATURAL_GAS': {
        "name": '天然气 (Natural Gas)',
        "calorificValue": 36.0,      # MJ/m3
        "co2Factor": 2.18,           # kg/m3
        "theoreticalAirNeed": 9.5,   # m3_air / m3_fuel
        "theoreticalGasFactor": 10.5,# m3_gas / m3_fuel
        "dewPointRef": 58.0,         # 绝热燃烧露点 (°C)
        "maxLatentRatio": 0.11       # 最大潜热比例 (约11%)
    },
    'COAL': {
        "name": '动力煤 (Coal)',
        "calorificValue": 29.3,
        "co2Factor": 2.6,
        "theoreticalAirNeed": 8.5,
        "theoreticalGasFactor": 9.0,
        "dewPointRef": 45.0,
        "maxLatentRatio": 0.0        # 煤通常不做冷凝
    },
    'DIESEL': {
        "name": '0# 柴油 (Diesel)',
        "calorificValue": 42.0,
        "co2Factor": 3.1,
        "theoreticalAirNeed": 11.0,
        "theoreticalGasFactor": 12.0,
        "dewPointRef": 48.0,
        "maxLatentRatio": 0.06
    }
}