const VALID_PULLS = new Set(['none', 'up', 'down']);

export function gpioOutputState(level = 'high') {
  const high = level === 'high';
  return {
    level: high ? 'high' : 'low',
    pinVoltage: high ? '接近 3.3V' : '接近 0V',
    raw: high ? 1 : 0,
    ledOn: !high,
    currentPath: high
      ? 'LED 两端都接近 3.3V，电压差很小，几乎没有电流。'
      : '3.3V → 限流电阻 → LED → GPIO → GND，形成闭合电流路径。'
  };
}

export function gpioInputState({ pull = 'none', pressed = false } = {}) {
  const safePull = VALID_PULLS.has(pull) ? pull : 'none';
  if (pressed) {
    const high = safePull === 'down';
    return {
      pull: safePull,
      pressed: true,
      floating: false,
      pinVoltage: high ? '接近 3.3V' : '接近 0V',
      raw: high ? 1 : 0,
      semanticPressed: true,
      currentPath: high
        ? '按钮闭合，把引脚用低阻路径接到 3.3V；这条强路径覆盖弱下拉。'
        : '按钮闭合，把引脚用低阻路径接到 GND；这条强路径覆盖上拉，或直接给无拉输入一个低电平。'
    };
  }
  if (safePull === 'up') {
    return {
      pull: safePull,
      pressed: false,
      floating: false,
      pinVoltage: '接近 3.3V',
      raw: 1,
      semanticPressed: false,
      currentPath: '按钮断开，只剩上拉电阻把引脚弱连接到 3.3V。'
    };
  }
  if (safePull === 'down') {
    return {
      pull: safePull,
      pressed: false,
      floating: false,
      pinVoltage: '接近 0V',
      raw: 0,
      semanticPressed: false,
      currentPath: '按钮断开，只剩下拉电阻把引脚弱连接到 GND。'
    };
  }
  return {
    pull: safePull,
    pressed: false,
    floating: true,
    pinVoltage: '没有可靠值',
    raw: null,
    semanticPressed: null,
    currentPath: '按钮断开，引脚也没有到 3.3V 或 GND 的稳定路径；一次读到 0 或 1 都不能作为保证。'
  };
}
