/*!
 * array-gpio/rpi.js
 *
 * Copyright(c) 2017 Ed Alegrid <ealegrid@gmail.com>
 * MIT Licensed
 *
 */

"use strict";

import { Stats } from "fs";

const fs = require("fs");
const os = require("os");
const cc = require("bindings")("node_rpi");

export type SpiDataMode = 0 | 1 | 2 | 3;

const EventEmitter = require("events");
class StateEmitter extends EventEmitter {}
const emitter = (exports.emitter = new StateEmitter());
emitter.setMaxListeners(2);

let BoardRev: number;
const BcmPin = {};
let inputPin: number[] = [];
let outputPin: number[] = [];
const watchData: { monitor: NodeJS.Timer; pin: number }[] = [];
const rpiSetup = {
  initialized: false,
  gpiomem: false,
  initI2c: false,
  initSpi: false,
};

/*
 * Verify if the board is a Raspberry Pi
 */
if (os.arch() === "arm" || os.arch() === "arm64") {
  //continue
} else {
  console.log(
    "Sorry, array-gpio has detected that your device is not a Raspberry Pi.\narray-gpio will only work in Raspberry Pi devices.\n"
  );
  throw new Error("device is not a raspberry pi");
}

/*
 * Check rpi board revision.
 */
/*fs.readFile('/proc/cpuinfo', function (err, info) {
    	if (err) throw err;

    	if (!info){
		return false;
    	}

    	info.toString().split(/\n/).forEach(function (line) {
		match = line.match(/^Revision.*(.{4})/);
		if (match) {
			return BoardRev = parseInt(match[1], 16);
		}
    	});

	//console.log('BoardRev', BoardRev.toString(16));
	switch (BoardRev) {
		case 0x10:
		case 0x12:
		case 0x13:
		case 0x14:
		case 0x15:
		case 0x32:
		case 0x92:
		case 0x93:
		case 0xc1:
		case 0x1041:
		case 0x2042:
		case 0x2082:
		case 0x20d3:
		case 0x20a0:
		case 0x20e0:
		break;
		default:
		console.log('\nSorry, your raspberry pi model is not currently supported at this time.\n');
		throw new Error('unsupported rpi board');
		return false;
	}
	return true;
});*/

/*
 * This module only supports 40-pin Raspberry Pi Models.
 * 40-pin Physical Board Pinout Mapping with BCM GPIOxx Pin Numbering.
 *
 * -1 indicates a power supply or a ground pin.
 */
const pinLayout = [
  -1, -1, -1 /* P1   P2  */, 2, -1 /* P3   P4  */, 3, -1 /* P5   P6  */, 4,
  14 /* P7   P8  */, -1, 15 /* P9   P10 */, 17, 18 /* P11  P12 */, 27,
  -1 /* P13  P14 */, 22, 23 /* P15  P16 */, -1, 24 /* P17  P18 */, 10,
  -1 /* P19  P20 */, 9, 25 /* P21  P22 */, 11, 8 /* P23  P24 */, -1,
  7 /* P25  P26 */, 0, 1 /* P27  P28 */, 5, -1 /* P29  P30 */, 6,
  12 /* P31  P32 */, 13, -1 /* P33  P34 */, 19, 16 /* P35  P36 */, 26,
  20 /* P37  P38 */, -1, 21 /* P39  P40 */,
];

const pinMap = new Map([
  [0, -1],
  [1, -1],
  [2, -1],
  [3, 2],
  [4, -1],
  [5, 3],
  [6, -1],
  [7, 4],
  [8, 14],
  [9, -1],
  [10, 15],
  [11, 17],
  [12, 18],
  [13, 27],
  [14, -1],
  [15, 22],
  [16, 23],
  [17, -1],
  [18, 24],
  [19, 10],
  [20, -1],
  [21, 9],
  [22, 25],
  [23, 11],
  [24, 8],
  [25, -1],
  [26, 7],
  [27, 0],
  [28, 1],
  [29, 5],
  [30, -1],
  [31, 6],
  [32, 12],
  [33, 13],
  [34, -1],
  [35, 19],
  [36, 16],
  [37, 26],
  [38, 20],
  [39, -1],
  [40, 21],
]);

/* Convert physical board pinout number to BCM pin numbering */
function convertPin(pin: number) {
  const gpioNumber = pinMap.get(pin);
  if (gpioNumber === -1) throw new Error(`Pin ${pin} is not GPIO`);
  if (gpioNumber === undefined) throw new Error(`Pin ${pin} is invalid`);
  return gpioNumber;
}

/* Check if the pin is being used by another application using '/sys/class/gpio/gpio' */
function check_sys_gpio(gpioPin: number, pin: number) {
  fs.stat(
    "/sys/class/gpio/gpio" + gpioPin,
    (err: NodeJS.ErrnoException, stats: Stats) => {
      if (err) {
        if (err.code === "ENOENT") {
          // '/sys/class/gpio/gpio' + gpioPin file does not exist
          return;
        }
        throw err;
      }
      if (stats) {
        // fs.writeFileSync('/sys/class/gpio/' + 'unexport', pin);
        console.log(
          "\n*** pin " + pin + " is being used in /sys/class/gpio file"
        );
        console.log(
          "*** Please check if another application is using this pin"
        );
        throw pin;
      }
    }
  );
}

/* error message for rpi mode conflict */
function rpiModeConflict() {
  console.log("\n** Peripheral access conflict.");
  console.log(
    "** I2C, SPI and PWM object creation takes precedence over GPIO object creation."
  );
  console.log(
    "** Try creating I2C/SPI/PWM objects before creating GPIO input/output objects.\n"
  );
}

/***
 *  Rpi class
 *
 *  Internal low-level direct register access library
 *  Incorrect use of this functions may cause hang-up/file corruptions
 */
class Rpi {
  LOW = 0x0 as const;
  HIGH = 0x1 as const;

  INPUT = 0x0 as const;
  OUTPUT = 0x1 as const;

  PULL_OFF = 0x0 as const;
  PULL_DOWN = 0x1 as const;
  PULL_UP = 0x2 as const;

  FALLING_EDGE = 0x1 as const;
  RISING_EDGE = 0x2 as const;
  BOTH = 0x3 as const;

  constructor() {}

  /*
   * rpi lib access methods
   */
  lib_init(access: 0 | 1) {
    /* reset pin store */
    // BcmPin = {};
    cc.rpi_init(access);

    rpiSetup.gpiomem = access === 0; // true: rpi in dev/gpiomem for GPIO, false : rpi in dev/mem for i2c, spi, pwm
    rpiSetup.initialized = true; // rpi must be initialized only once
  }

  lib_close() {
    return cc.rpi_close();
  }

  /*
   * GPIO
   */
  gpio_open(pin: number, mode: 0x0 | 0x1, init: number) {
    const gpioPin = convertPin(pin);
    if (!rpiSetup.initialized) {
      this.lib_init(0);
    }

    check_sys_gpio(gpioPin, pin);

    /* pin initial state */
    cc.gpio_config(gpioPin, this.INPUT);
    cc.gpio_enable_pud(gpioPin, this.PULL_OFF);

    /* set as INPUT */
    if (mode === this.INPUT) {
      const result = cc.gpio_config(gpioPin, this.INPUT);

      if (init) {
        cc.gpio_enable_pud(gpioPin, init);
      } else {
        cc.gpio_enable_pud(
          gpioPin,
          this.PULL_OFF
        ); /* initial PUD setup, none */
      }
      // track all input pins
      inputPin.push(pin);

      // remove duplicates
      inputPin = inputPin.filter((c, index) => inputPin.indexOf(c) === index);

      return result;
    } else if (mode === this.OUTPUT) {
      /* set as OUTPUT */
      const result = cc.gpio_config(gpioPin, this.OUTPUT);
      if (init) {
        cc.gpio_write(gpioPin, init);
      } else {
        cc.gpio_write(gpioPin, this.LOW); /* initial state is OFF */
      }
      // track all output pins
      outputPin.push(pin);

      // remove duplicates
      outputPin = outputPin.filter(
        (c, index) => outputPin.indexOf(c) === index
      );

      return result;
    } else {
      throw new Error("Unsupported mode " + mode);
    }
  }

  gpio_close(pin: number) {
    const gpioPin = convertPin(pin);

    if (!rpiSetup.gpiomem) {
      cc.gpio_enable_pud(gpioPin, this.PULL_OFF);
    }

    /* reset pin to input */
    cc.gpio_config(gpioPin, this.INPUT);
    cc.gpio_enable_pud(gpioPin, this.PULL_OFF);

    inputPin = inputPin.filter(function (item) {
      return item !== pin;
    });

    outputPin = outputPin.filter(function (item) {
      return item !== pin;
    });
  }

  gpio_enable_async_rising_pin_event(pin: number) {
    cc.gpio_enable_async_rising_event(convertPin(pin), 1);
  }

  gpio_detect_input_pin_event(pin: number) {
    return cc.gpio_detect_input_event(convertPin(pin)) as number;
  }

  gpio_reset_all_pin_events(pin: number) {
    cc.gpio_reset_all_events(convertPin(pin));
  }

  gpio_reset_pin_event(pin: number) {
    cc.gpio_reset_event(convertPin(pin));
  }

  gpio_write(pin: number, value: number) {
    return cc.gpio_write(convertPin(pin), value) as number;
  }

  gpio_read(pin: number) {
    return cc.gpio_read(convertPin(pin));
  }

  gpio_enable_pud(pin: number, value: number) {
    cc.gpio_enable_pud(convertPin(pin), value);
  }

  gpio_watchPin(
    edge: ((...args: any) => void) | string | number | null,
    cb: (...args: any) => void,
    pin: number,
    td: number
  ) {
    /* check pin if valid */

    //@ts-ignore
    if (cb) {
      try {
        this.gpio_read(pin);
      } catch (e) {
        throw new Error("invalid pin");
      }
    }

    let on = false;

    if (typeof edge === "function" && typeof cb === "number") {
      td = cb;
      cb = edge;
      edge = null;
    } else if (typeof edge === "function" && cb === undefined) {
      cb = edge;
      edge = null;
    } else if (
      typeof edge !== "string" &&
      typeof edge !== "number" &&
      edge !== null
    ) {
      throw new Error("invalid edge argument");
    } else if (
      (typeof edge === "string" || typeof edge === "number") &&
      typeof cb !== "function"
    ) {
      throw new Error("invalid callback argument");
    }

    /* set internal pull-down resistor */
    // conflict with pull-up resistor from Paulo Castro 1/14/2022
    // need to validate with new RPI boards as well as with new RPI OS's
    //cc.gpio_enable_pud(convertPin(pin), this.PULL_DOWN);

    if (!td) {
      td = 100;
    }

    function logic() {
      if (cc.gpio_read(convertPin(pin)) && !on) {
        on = true;
        if (edge === 1 || edge === "re" || edge === "both" || edge === null) {
          setImmediate(cb, true, pin);
        }
      } else if (!cc.gpio_read(convertPin(pin)) && on) {
        on = false;
        if (edge === 0 || edge === "fe" || edge == "both" || edge === null) {
          setImmediate(cb, false, pin);
        }
      }
    }

    /*cc.gpio_reset_all_events(convertPin(pin));
	cc.gpio_enable_async_rising_event(convertPin(pin), 1);

	function logic () {
		if(cc.gpio_detect_input_event(convertPin(pin)) && !on){
			on = true;
			if(edge === 1 || edge === 're' || edge === 'both' ||  edge === null ){
				setImmediate(cb, true, pin);
			}
			cc.gpio_reset_event(convertPin(pin))
		}
		else if(!cc.gpio_detect_input_event(convertPin(pin)) && on){
			on = false;
			if(edge === 0 || edge === 'fe' || edge == 'both' || edge === null){  
				setImmediate(cb, false, pin);
			}
			cc.gpio_reset_event(convertPin(pin))
		}
		
	}*/

    let monitor = setInterval(logic, td);
    let monData = { monitor: monitor, pin: pin };
    watchData.push(monData);
  }

  gpio_unwatchPin(pin: number) {
    watchData.forEach((monData, index) => {
      if (monData.pin === pin) {
        clearInterval(monData.monitor);
        watchData.splice(index, 1);
      }
    });
  }

  /*
   * PWM
   */
  pwmInit() {
    /* check if GPIO is already using the rpi library in gpiomem */
    if (rpiSetup.initialized && rpiSetup.gpiomem) {
      rpiModeConflict();
      rpiSetup.gpiomem = false;
      this.pwmReset();
      throw new Error("pwm peripheral access conflict");
    }
    /* PWM peripheral requires /dev/mem */
    if (!rpiSetup.initialized) {
      this.lib_init(1);
    }
  }

  pwmResetPin(pin: number) {
    const gpioPin = convertPin(pin);
    const v = outputPin.indexOf(gpioPin);
    if (v === -1) {
      cc.pwm_reset_pin(gpioPin);
      this.gpio_close(gpioPin);
    }
  }

  pwmReset() {
    cc.pwm_reset_all_pins();
  }

  /*
   * available pins for PWM - RPi 3 / RPi 4
   * PHY pin  BCM GPIO pin
   *    12         18
   *    32         12
   *    33         13
   *    35         19
   */
  pwmSetup(pin: number, start: boolean, mode?: boolean) {
    const gpioPin = convertPin(pin);

    check_sys_gpio(gpioPin, pin);

    /* true - enable pwm, false - disable */
    if (arguments[1] === undefined && start === undefined) {
      start = false;
    }
    /* true for m/s mode, false for balanced mode */
    if (arguments[2] === undefined && mode === undefined) {
      mode = true;
    }

    cc.pwm_set_pin(gpioPin);
    cc.pwm_set_mode(gpioPin, Number(mode));
    cc.pwm_enable(gpioPin, Number(start));
  }

  pwmSetClockDivider(divider: number) {
    return cc.pwm_set_clock_freq(divider);
  }

  pwmSetRange(pin: number, range: number) {
    return cc.pwm_set_range(convertPin(pin), range);
  }

  pwmSetData(pin: number, data: number) {
    return cc.pwm_set_data(convertPin(pin), data);
  }

  /*
   * I2C
   */
  i2cBegin() {
    if (rpiSetup.initialized && rpiSetup.gpiomem) {
      rpiModeConflict();
      rpiSetup.gpiomem = false;
      throw new Error("i2c peripheral access conflict");
    }
    /* I2C requires /dev/mem */
    this.init(1);
    rpiSetup.initI2c = true;
    return cc.i2c_start();
  }

  i2cInit(pinSet: 0 | 1) {
    if (rpiSetup.initialized && rpiSetup.gpiomem) {
      rpiModeConflict();
      rpiSetup.gpiomem = false;
      throw new Error("i2c peripheral access conflict");
    }
    /* I2C requires /dev/mem */
    if (!rpiSetup.initialized) {
      rpiSetup.initI2c = true;
      if (pinSet === 0) {
        return cc.i2c_init(0); // use SDA0 and SCL0 pins
      } else if (pinSet === 1) {
        return cc.i2c_init(1); // use SDA1 and SCL1 pins
      }
    }
  }

  i2cSetSlaveAddress(addr: number) {
    cc.i2c_select_slave(addr);
  }

  i2cSetClockDivider(divider: number) {
    cc.i2c_set_clock_freq(divider);
  }

  i2cSetBaudRate(baud: number) {
    return cc.i2c_data_transfer_speed(baud);
  }

  i2cRead(buf: Buffer, len: number) {
    if (len === undefined) len = buf.length;

    if (len > buf.length) throw new Error("Insufficient buffer size");

    return cc.i2c_read(buf, len);
  }

  i2cByteRead() {
    return cc.i2c_byte_read();
  }

  i2cWrite(buf: Buffer, len: number) {
    if (len === undefined) len = buf.length;

    if (len > buf.length) throw new Error("Insufficient buffer size");

    return cc.i2c_write(buf, len);
  }

  i2cEnd() {
    cc.i2c_stop();
  }

  /*
   * SPI
   */
  spiGetBoardRev() {
    return BoardRev;
  }

  spiBegin() {
    if (rpiSetup.initialized && rpiSetup.gpiomem) {
      rpiModeConflict();
      rpiSetup.gpiomem = false;
      throw new Error("spi peripheral access conflict");
    }

    /* SPI requires /dev/mem */
    if (!rpiSetup.initialized) {
      this.lib_init(1);
    }
    rpiSetup.initSpi = true;
    return cc.spi_start();
  }

  spiChipSelect(cs: number) {
    cc.spi_chip_select(cs);
  }

  spiSetCSPolarity(cs: 0 | 1 | 2, active: 0 | 1) {
    cc.spi_set_chip_select_polarity(cs, active);
  }

  spiSetClockDivider(divider: number) {
    if (divider % 2 !== 0 || divider < 0 || divider > 65536)
      throw new Error(
        "Clock divider must be an even number between 0 and 65536"
      );

    cc.spi_set_clock_freq(divider);
  }

  spiSetDataMode(mode: SpiDataMode) {
    cc.spi_set_data_mode(mode);
  }

  spiTransfer(wbuf: Buffer, rbuf: Buffer, len: number) {
    cc.spi_data_transfer(wbuf, rbuf, len);
  }

  spiWrite(wbuf: Buffer, len: number) {
    cc.spi_write(wbuf, len);
  }

  spiRead(rbuf: Buffer, len: number) {
    cc.spi_read(rbuf, len);
  }

  spiEnd() {
    cc.spi_stop();
  }

  /*
   * time delay methods
   */
  // delay in milliseconds
  mswait(ms: number) {
    cc.mswait(ms);
  }
  // delay in microseconds
  uswait(us: number) {
    cc.uswait(us);
  }
} // end of Rpi class

module.exports = new Rpi();

process.on("exit", () => {
  cc.rpi_close();
});
