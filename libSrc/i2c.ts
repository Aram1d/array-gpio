/*!
 * array-gpio/i2c.js
 *
 * Copyright(c) 2017 Ed Alegrid
 * MIT Licensed
 */

import rpi, { i2cPinSet } from "./rpi.js";

let test = false;

/*
 * i2c class
 * has to be instantiated with on of the pinSet:
 * value 1 (GPIO 02/pin 03 SDA1, GPIO 03/pin 05 SCL1)
 * value 0 (GPIO 00/pin 27 SDA0, GPIO 01/pin 28 SCL0)
 */
class I2C {
  constructor(pinSet?: i2cPinSet) {
    if (!pinSet) {
      this.startI2C(1);
    } else {
      this.startI2C(pinSet);
    }
  }

  begin() {
    return rpi.i2cBegin();
  }

  startI2C(pinSet: i2cPinSet) {
    return rpi.i2cInit(pinSet);
  }

  test() {
    test = true;
  }

  setBaudRate(baud: number) {
    if (test) return;
    rpi.i2cSetBaudRate(baud);
    console.log(`I2C data rate: ${baud / 1000} kHz`);
  }

  setTransferSpeed(baud: number) {
    if (test) return;
    rpi.i2cSetBaudRate(baud);
    console.log(`I2C data rate: ${baud / 1000} kHz`);
  }

  setClockFreq(div: number) {
    const freq = Math.round(250000000 / div);
    const Freq = Math.round(freq / 1000);

    console.log(`I2C data rate: ${Freq} kHz (div ${div})`);
    if (test) {
      return;
    }
    rpi.i2cSetClockDivider(div);
  }

  /* returns 1 if successful, otherwise returns 0*/
  selectSlave(value: number) {
    if (test) return;
    return rpi.i2cSetSlaveAddress(value);
  }

  /* read data bytes from periphetal registers using node buffer objects */
  read(buf: Buffer, len: number) {
    if (test) return;
    rpi.i2cRead(buf, len);
  }

  /* write data bytes to periphetal registers using node buffer objects */
  write(buf: Buffer, len: number) {
    if (test) return;
    rpi.i2cWrite(buf, len);
  }

  end() {
    rpi.i2cEnd();
  }
}

export default I2C;
