import test from 'node:test';
import assert from 'node:assert/strict';
import { gpioInputState, gpioOutputState } from '../public/assets/gpio-concept-lab.mjs';

test('低电平有效 LED 实验把物理电平与灯光语义分开', () => {
  const high = gpioOutputState('high');
  const low = gpioOutputState('low');

  assert.deepEqual({ raw: high.raw, ledOn: high.ledOn, pinVoltage: high.pinVoltage }, {
    raw: 1,
    ledOn: false,
    pinVoltage: '接近 3.3V'
  });
  assert.deepEqual({ raw: low.raw, ledOn: low.ledOn, pinVoltage: low.pinVoltage }, {
    raw: 0,
    ledOn: true,
    pinVoltage: '接近 0V'
  });
  assert.match(low.currentPath, /限流电阻.*LED.*GPIO.*GND/);
});

test('按钮实验区分浮空、上拉和下拉的释放与按下状态', () => {
  assert.deepEqual(gpioInputState({ pull: 'none', pressed: false }), {
    pull: 'none',
    pressed: false,
    floating: true,
    pinVoltage: '没有可靠值',
    raw: null,
    semanticPressed: null,
    currentPath: '按钮断开，引脚也没有到 3.3V 或 GND 的稳定路径；一次读到 0 或 1 都不能作为保证。'
  });

  const pullUpReleased = gpioInputState({ pull: 'up', pressed: false });
  const pullUpPressed = gpioInputState({ pull: 'up', pressed: true });
  assert.deepEqual([pullUpReleased.raw, pullUpPressed.raw], [1, 0]);
  assert.deepEqual([pullUpReleased.semanticPressed, pullUpPressed.semanticPressed], [false, true]);

  const pullDownReleased = gpioInputState({ pull: 'down', pressed: false });
  const pullDownPressed = gpioInputState({ pull: 'down', pressed: true });
  assert.deepEqual([pullDownReleased.raw, pullDownPressed.raw], [0, 1]);
  assert.deepEqual([pullDownReleased.semanticPressed, pullDownPressed.semanticPressed], [false, true]);
});
