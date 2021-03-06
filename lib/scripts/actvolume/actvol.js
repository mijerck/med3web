/*
Licensed to the Apache Software Foundation (ASF) under one
or more contributor license agreements.  See the NOTICE file
distributed with this work for additional information
regarding copyright ownership.  The ASF licenses this file
to you under the Apache License, Version 2.0 (the
"License"); you may not use this file except in compliance
with the License.  You may obtain a copy of the License at

  http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing,
software distributed under the License is distributed on an
"AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
KIND, either express or implied.  See the License for the
specific language governing permissions and limitations
under the License.
*/

/**
* Active volume algorithm implementation
* @module lib/scripts/actvolume/actvol
*/

// absolute imports
import * as THREE from 'three';

// relative imports
import TetrahedronGenerator from './tetra';
import GeoRender from './georender';

const ACT_VOL_NUM_SMOOTH_STAGES = 18;

const AV_NUM_COLORS = 256;

const AV_STATE_NA = -1;
const AV_STATE_NOT_STARTED = 0;
const AV_STATE_PREPARE_GAUSS = 1;
const AV_STATE_PREPARE_UNIFORMITY = 2;
const AV_STATE_UPDATE_GEO = 3;
const AV_STATE_FINISHED = 4;

const AV_METHOD_NORMALS = 1;
const AV_METHOD_UNIFORMITY = 2;
const AV_METHOD_COLOR_KOEFS = 4;
const AV_METHOD_ALL = 0xffff;

/**
* Class ActiveVolume perform skull detection and removal
* @class ActiveVolume
*/
export default class ActiveVolume {
  /**
  * Init all internal data
  * @constructs ActiveVolume
  */
  constructor() {
    this.m_state = AV_STATE_NA;
    this.m_pixelsSrc = null;
    this.m_xDim = 0;
    this.m_yDim = 0;
    this.m_zDim = 0;
    this.m_imageGauss = null;
    this.m_imageUniformity = null;
    this.m_verticesNew = null;
    this.m_lapSmoother = null;
    this.m_imageSrc = null;
    this.m_imageGrad = null;
    this.m_gaussStage = -1;
    this.m_uniformityStage = -1;
    this.m_geoStage = -1;
    this.m_histogram = new Int32Array(AV_NUM_COLORS);
    this.m_colorProbability = new Float32Array(AV_NUM_COLORS);
    this.m_colorKoefs = new Float32Array(AV_NUM_COLORS);
    for (let i = 0; i < AV_NUM_COLORS; i++) {
      this.m_histogram[i] = 0;
      this.m_colorProbability[i] = 0.0;
      this.m_colorKoefs[i] = 0.0;
    }
    this.m_indexMinColor = -1;
  }

  /**
  * Remove skull
  * @param {number} xDim volume dimension on x
  * @param {number} yDim volume dimension on y
  * @param {number} zDim volume dimension on z
  * @param {array}  volTexSrc source volume
  * @param {array}  volTexDst destination volume
  * @param {boolean} needCreateMask Need create mask wioth 0 or 255 value
  * @param {boolean} needLog Need intensive log
  * @return {number} 1, if success. <0 if failed
  */
  skullRemove(xDim, yDim, zDim, volTexSrc, volTexDst, needCreateMask, needLog) {
    console.log(`skullRemove params. needCreateMask = ${needCreateMask}, needLog = ${needLog}`);
    const TOO_MUCH_SIZE = 8192;
    if ((xDim >= TOO_MUCH_SIZE) || (yDim >= TOO_MUCH_SIZE) || (zDim >= TOO_MUCH_SIZE)) {
      console.log(`Too bad volume dimension: ${xDim} * ${yDim} * ${zDim}`);
      return -1;
    }
    if ((xDim <= 1) || (yDim <= 1) || (zDim <= 1)) {
      console.log(`Too bad volume dimension: ${xDim} * ${yDim} * ${zDim}`);
      return -1;
    }
    const okCreate = this.create(xDim, yDim, zDim, volTexSrc);
    if (okCreate !== 1) {
      return okCreate;
    }
    const genTetra = new TetrahedronGenerator();
    const vRadius = new THREE.Vector3(0.5, 0.5, 0.5);
    const NUM_SUBDIVIDES = 3;
    const okCreateTetra = genTetra.create(vRadius, NUM_SUBDIVIDES);
    if (okCreateTetra < 1) {
      return okCreateTetra;
    }
    const geoRender = new GeoRender();
    const errGeo = geoRender.createFromTetrahedronGenerator(genTetra);
    const GEO_OK = 1;
    if (errGeo !== GEO_OK) {
      const ERR_CREATE_GEO = -3;
      return ERR_CREATE_GEO;
    }

    // get half from volume dimension
    const xDim2 = (this.m_xDim - 1) * 0.5;
    const yDim2 = (this.m_yDim - 1) * 0.5;
    const zDim2 = (this.m_zDim - 1) * 0.5;

    // scale geo render vertices
    const numVertices = geoRender.getNumVertices();
    const vertices = geoRender.getVertices();
    const COORDS_IN_VERTEX = 4;
    const NUM_0 = 0;
    const NUM_1 = 1;
    const NUM_2 = 2;
    for (let i = 0, i4 = 0; i < numVertices; i++, i4 += COORDS_IN_VERTEX) {
      vertices[i4 + NUM_0] = xDim2 + xDim2 * vertices[i4 + NUM_0];
      vertices[i4 + NUM_1] = yDim2 + yDim2 * vertices[i4 + NUM_1];
      vertices[i4 + NUM_2] = zDim2 + zDim2 * vertices[i4 + NUM_2];
    } // for (i) all vertices

    // !!!!!!!! TEST !!!!!!!!
    // save render geo to obj file
    // const TEST_SAVE_GEO_FILE_NAME = 'dump/test.obj';
    // geoRender.saveGeoToObjFile(TEST_SAVE_GEO_FILE_NAME);

    // perform itertaions: update geo
    let isFinished = false;
    const numPredSteps = this.getPredictedStepsForActiveVolumeUpdate();
    // !!!!!!!! TEST !!!!!!!!
    // const numPredSteps = 32;

    console.log(`skullRemove. Will be ${numPredSteps} updates approximately`);
    let iter;
    for (iter = 0; (iter < numPredSteps) && !isFinished; iter++) {
      //if (needLogPrintf) {
      //  printf(".");
      // }
      this.updateGeo(geoRender, AV_METHOD_ALL);
      isFinished = (this.m_state === AV_STATE_FINISHED);
    }
    // !!!!!!!! TEST !!!!!!!!
    // Save smoothed image into file
    const NEED_SAVE_BMP = false;
    if (NEED_SAVE_BMP) {
      const TEST_SAVE_VOL_FILE_NAME = 'test_vol.bmp';
      const zSlice = this.m_zDim / NUM_2;
      ActiveVolume.saveVolumeSliceToFile(this.m_imageGauss,
        this.m_xDim, this.m_yDim, this.m_zDim, zSlice, TEST_SAVE_VOL_FILE_NAME);
    }

    // create clipped volume
    // const BUILD_MASK = 0;
    // VolumeClipper::clipVolumeByNonConvexGeo(texSrc, texDst, geo, BUILD_MASK);

    return +1;
  } // skullRemove

  /**
  * Save volume slice to BMP file. Only for deep debug
  * @param {array} pixelsSrc array of source voxels in volume
  * @param {number} xDim Volume dimension on x
  * @param {number} yDim Volume dimension on y
  * @param {number} zDim Volume dimension on z
  * @param {number} zSlice index of slice in volume
  * @param {string } fileName save file name
  */
  static saveVolumeSliceToFile(pixelsSrc, xDim, yDim, zDim, zSlice, fileName) {
    const SIZE_HEADER = 14;
    const SIZE_INFO = 40;
    const COMPS_IN_COLOR = 3;
    const numPixels = xDim * yDim;
    let pixStride = COMPS_IN_COLOR  * xDim;
    pixStride = (pixStride + COMPS_IN_COLOR) & (~COMPS_IN_COLOR);
    const totalBufSize = SIZE_HEADER + SIZE_INFO + (numPixels * COMPS_IN_COLOR);
    const buf = new Uint8Array(totalBufSize);
    for (let j = 0; j < totalBufSize; j++) {
      buf[j] = 0;
    }
    const BYTE_MASK = 255;
    const BITS_IN_BYTE = 8;
    // write header
    const BYTES_IN_DWORD = 4;

    let i = 0;
    // bfType[16]
    buf[i++] = 0x42;
    buf[i++] = 0x4D;
    // bfSize[32]
    let bfSize = SIZE_HEADER + SIZE_INFO + pixStride * yDim;
    buf[i++] = bfSize & BYTE_MASK; bfSize >>= BITS_IN_BYTE;
    buf[i++] = bfSize & BYTE_MASK; bfSize >>= BITS_IN_BYTE;
    buf[i++] = bfSize & BYTE_MASK; bfSize >>= BITS_IN_BYTE;
    buf[i++] = bfSize & BYTE_MASK;
    // bfReserved1 + bfReserved2
    i += BYTES_IN_DWORD;
    // bfOffBits[32]
    let bfOffBits = SIZE_HEADER + SIZE_INFO;
    buf[i++] = bfOffBits & BYTE_MASK; bfOffBits >>= BITS_IN_BYTE;
    buf[i++] = bfOffBits & BYTE_MASK; bfOffBits >>= BITS_IN_BYTE;
    buf[i++] = bfOffBits & BYTE_MASK; bfOffBits >>= BITS_IN_BYTE;
    buf[i++] = bfOffBits & BYTE_MASK;

    // write info

    // biSize[32]
    let biSize = SIZE_INFO;
    buf[i++] = biSize & BYTE_MASK; biSize >>= BITS_IN_BYTE;
    buf[i++] = biSize & BYTE_MASK; biSize >>= BITS_IN_BYTE;
    buf[i++] = biSize & BYTE_MASK; biSize >>= BITS_IN_BYTE;
    buf[i++] = biSize & BYTE_MASK;
    // biWidth[32]
    let biWidth = xDim;
    buf[i++] = biWidth & BYTE_MASK; biWidth >>= BITS_IN_BYTE;
    buf[i++] = biWidth & BYTE_MASK; biWidth >>= BITS_IN_BYTE;
    buf[i++] = biWidth & BYTE_MASK; biWidth >>= BITS_IN_BYTE;
    buf[i++] = biWidth & BYTE_MASK;
    // biHeight[32]
    let biHeight = yDim;
    buf[i++] = biHeight & BYTE_MASK; biHeight >>= BITS_IN_BYTE;
    buf[i++] = biHeight & BYTE_MASK; biHeight >>= BITS_IN_BYTE;
    buf[i++] = biHeight & BYTE_MASK; biHeight >>= BITS_IN_BYTE;
    buf[i++] = biHeight & BYTE_MASK;
    // biPlanes[16]
    buf[i++] = 1;
    buf[i++] = 0;
    // biBitCount[16]
    buf[i++] = 24;
    buf[i++] = 0;
    // biCompression[32]
    i += BYTES_IN_DWORD;
    // biSizeImage[32]
    let biSizeImage = pixStride * yDim;
    buf[i++] = biSizeImage & BYTE_MASK; biSizeImage >>= BITS_IN_BYTE;
    buf[i++] = biSizeImage & BYTE_MASK; biSizeImage >>= BITS_IN_BYTE;
    buf[i++] = biSizeImage & BYTE_MASK; biSizeImage >>= BITS_IN_BYTE;
    buf[i++] = biSizeImage & BYTE_MASK;
    // biXPelsPerMeter[32]
    i += BYTES_IN_DWORD;
    // biYPelsPerMeter[32]
    i += BYTES_IN_DWORD;
    // biClrUsed[32]
    i += BYTES_IN_DWORD;
    // biClrImportant[32]
    i += BYTES_IN_DWORD;

    // write pixels
    const offSlice = zSlice * xDim * yDim;
    for (let j = 0; j < numPixels; j++) {
      const valGrey = pixelsSrc[offSlice + j];
      // write rgb components
      buf[i++] = valGrey;
      buf[i++] = valGrey;
      buf[i++] = valGrey;
    }

    // write buffer to file
    const blob = new Blob([buf], { type: 'application/octet-stream' });
    const url = URL.createObjectURL(blob);
    const linkGen = document.createElement('a');
    linkGen.setAttribute('href', url);
    linkGen.setAttribute('download', fileName);
    const eventGen = document.createEvent('MouseEvents');
    eventGen.initMouseEvent('click', true, true, window, 1, 0, 0, 0, 0, false, false, false, false, 0, null);
    linkGen.dispatchEvent(eventGen);
  }

  getPredictedStepsForActiveVolumeUpdate() {
    const TWO = 2;
    const hx = this.m_xDim / TWO;
    const hy = this.m_yDim / TWO;
    const hz = this.m_zDim / TWO;
    const xyMax = (hx > hy) ? hx : hy;
    const xyzMax = (xyMax > hz) ? xyMax : hz;
    const stepsAll = xyzMax + ACT_VOL_NUM_SMOOTH_STAGES;
    return stepsAll;
  }
  /**
  * Create tetrahedron geometry
  * @return {number} 1, if success. <0 if failed
  */
  create(xDim, yDim, zDim, volTexSrc) {
    this.m_state = AV_STATE_NOT_STARTED;
    this.m_pixelsSrc = volTexSrc;
    this.m_xDim = xDim;
    this.m_yDim = yDim;
    this.m_zDim = zDim;
    const numPixels = xDim * yDim * zDim;
    this.m_imageGauss = new Float32Array(numPixels);
    this.m_imageUniformity = new Float32Array(numPixels);
    this.m_verticesNew = null;

    // good result
    return 1;
  }
  /**
  * Start image smoothimg by Gauss convolution
  */
  startImageSmooth() {
    const numPixels = this.m_xDim * this.m_yDim * this.m_zDim;
    let i;
    for (i = 0; i < numPixels; i++) {
      this.m_imageGauss[i] = 0.0;
      this.m_imageUniformity[i] = 0.0;
    }
    this.m_imageSrc = new Float32Array(numPixels);
    this.m_imageGrad = new Float32Array(numPixels);
    for (i = 0; i < numPixels; i++) {
      this.m_imageGrad[i] = 0.0;
      const val = this.m_pixelsSrc[i];
      this.m_imageSrc[i] = val;
    }
    return 1;
  }
  /**
  * Stop volume smothing by Gauss
  */
  stopImageSmooth() {
    this.m_imageGrad = null;
    this.m_imageSrc = null;
  }
  applyPartGaussSmooth(zStart, zEnd, rad, sigma) {
    const TWICE = 2;
    const dia = 1 + TWICE * rad;
    // fill gauss matrix
    const THREE_DIMS = 3.0;
    const koef = 1.0 / (THREE_DIMS * sigma * sigma);
    let dx, dy, dz;
    let j = 0;
    if (zStart === 0) {
      const GAUSS_MAX_RAD = 9;
      const GAUSS_MAX_DIA = (1 + TWICE * GAUSS_MAX_RAD);
      this.m_gaussMatrix = new Float32Array(GAUSS_MAX_DIA * GAUSS_MAX_DIA * GAUSS_MAX_DIA);
      let wSum = 0.0;
      for (dz = -rad; dz <= +rad; dz++) {
        const fz = dz / rad;
        for (dy = -rad; dy <= +rad; dy++) {
          const fy = dy / rad;
          for (dx = -rad; dx <= +rad; dx++) {
            const fx = dx / rad;
            const dist2 = fx * fx + fy * fy + fz * fz;
            const weight = Math.exp(-1.0 * dist2 * koef);
            this.m_gaussMatrix[j++] = weight;
            wSum += weight;
          }
        }
      }     // for (dz)
      // normalize weights
      const numGaussElems = dia * dia * dia;
      const gScale = 1.0 / wSum;
      for (j = 0; j < numGaussElems; j++) {
        this.m_gaussMatrix[j] *= gScale;
      }
      const numPixels = this.m_xDim * this.m_yDim * this.m_zDim;
      for (j = 0; j < numPixels; j++) {
        this.m_imageGauss[j] = this.m_imageSrc[j];
      }
    }
    // apply gauss matrix to source image
    const zs = (zStart > rad) ? zStart : rad;
    const ze = (zEnd < this.m_zDim - rad) ? zEnd : (this.m_zDim - rad);
    let cx, cy, cz;
    for (cz = zs; cz < ze; cz++) {
      const czOff = cz * this.m_xDim * this.m_yDim;
      for (cy = rad; cy < this.m_yDim - rad; cy++) {
        const cyOff = cy * this.m_xDim;
        for (cx = rad; cx < this.m_xDim - rad; cx++) {
          let sum = 0.0;
          j = 0;
          for (dz = -rad; dz <= +rad; dz++) {
            const z = cz + dz;
            const zOff = z * this.m_xDim * this.m_yDim;
            for (dy = -rad; dy <= +rad; dy++) {
              const y = cy + dy;
              const yOff = y * this.m_xDim;
              for (dx = -rad; dx <= +rad; dx++) {
                const x = cx + dx;
                const weight = this.m_gaussMatrix[j++];
                const val = this.m_pixelsSrc[x + yOff + zOff];
                sum += val * weight;
              }   // for (dx)
            }     // for (dy)
          }       // for (dz)
          this.m_imageGauss[cx + cyOff + czOff] = sum;
        }     // for (cx)
      }       // for (cy)
    }         // for (cz)
  }
  /**
  * Smooth step
  */
  static smoothStep(minRange, maxRange, arg) {
    let t = (arg - minRange) / (maxRange - minRange);
    t = (t > 0.0) ? t : 0.0;
    t = (t < 1.0) ? t : 1.0;
    const NUM_2 = 2.0;
    const NUM_3 = 3.0;
    const res = t * t * (NUM_3 - NUM_2 * t);
    return res;
  }
  /**
  * Smooth 1d float array
  */
  static smoothArray(values, numValues, gaussRad, gaussSigma) {
    const dst = new Float32Array(AV_NUM_COLORS);
    const mult = 1.0 / (gaussSigma * gaussSigma);
    for (let ci = 0; ci < numValues; ci++) {
      let sum = 0.0;
      let sumWeight = 0.0;
      for (let di = -gaussRad; di <= +gaussRad; di++) {
        let i = ci + di;
        i = (i >= 0) ? i : 0;
        i = (i < numValues) ? i : (numValues - 1);
        const t = di / gaussRad;
        const weight = 1.0 / Math.exp(t * t * mult);
        sumWeight += weight;
        sum += values[i] * weight;
      }
      const valSmoothed = sum / sumWeight;
      dst[ci] = valSmoothed;
    }
    // copy back
    for (let i = 0; i < numValues; i++) {
      values[i] = dst[i];
    }
  }
  /**
  * Get histogram from gaussian smoothed image
  */
  getHistogram() {
    let i;
    for (i = 0; i < AV_NUM_COLORS; i++) {
      this.m_histogram[i] = 0;
    }
    const numPixels = this.m_xDim * this.m_yDim * this.m_zDim;
    const MAX_COLOR = AV_NUM_COLORS - 1;
    for (i = 0; i < numPixels; i++) {
      let val = Math.floor(this.m_imageGauss[i]);
      val = (val < MAX_COLOR) ? val : MAX_COLOR;
      this.m_histogram[val]++;
    }
    // get probabilities of each color in histogram
    for (i = 0; i < AV_NUM_COLORS; i++) {
      const h = this.m_histogram[i];
      this.m_colorProbability[i] = h / numPixels;
    }
    // find min probability
    this.m_indexMinColor = 0;
    const MAGIC_PART_HIST = 64;
    for (i = 1; i < MAGIC_PART_HIST; i++) {
      const isCurMin = (this.m_colorProbability[i] < this.m_colorProbability[i + 1]) &&
        (this.m_colorProbability[i] < this.m_colorProbability[i - 1]);
      if (isCurMin) {
        this.m_indexMinColor = i;
        break;
      }
    }     // for (i) all first 64 colors in palette
    // build color koefs
    // const float POW_KOEF = 2.0;
    const POW_KOEF = 0.3;
    for (i = 0; i < AV_NUM_COLORS; i++) {
      const delta = Math.abs(i - this.m_indexMinColor);
      this.m_colorKoefs[i] = 1.0 - 1.0 / (1.0 + delta ** POW_KOEF);
    }

    // scan image near central line
    const SCAN_RANGE  = 4;
    const TWO = 2;
    const zMin = this.m_zDim / TWO - SCAN_RANGE;
    const zMax = this.m_zDim / TWO + SCAN_RANGE;
    const yMin = this.m_yDim / TWO - SCAN_RANGE;
    const yMax = this.m_yDim / TWO + SCAN_RANGE;
    const NUM_20 = 20.0;
    const NUM_526 = 20.0;
    const RATIO_BORDER = NUM_20 / NUM_526;
    const xMin = this.m_xDim * RATIO_BORDER;
    const xMax = this.m_xDim - xMin;

    // get black color on image border
    let colBlack = 0.0;
    let numPixelsBorder = 0;
    let x, y, z;

    for (z = zMin; z < zMax; z++) {
      const zOff = z * this.m_xDim * this.m_yDim;
      for (y = yMin; y < yMax; y++) {
        const yOff = y * this.m_xDim;
        for (x = 0; x < xMin; x++) {
          const off = x + yOff + zOff;
          colBlack += this.m_imageGauss[off];
          numPixelsBorder++;
        }
        for (x = xMax; x < this.m_xDim; x++) {
          const off = x + yOff + zOff;
          colBlack += this.m_imageGauss[off];
          numPixelsBorder++;
        }
      }
    }
    colBlack /= numPixelsBorder;

    // Find where border is started (Left and Right)

    const w2 = this.m_xDim / TWO;
    let xLeftMin = this.m_xDim;
    let xRightMax = 0;
    const VAL_BORDER_ADD  = 40.0;

    for (z = zMin; z < zMax; z++) {
      const zOff = z * this.m_xDim * this.m_yDim;
      for (y = yMin; y < yMax; y++) {
        const yOff = y * this.m_xDim;
        for (x = xMin; x < w2; x++) {
          const off = x + yOff + zOff;
          if (this.m_imageGauss[off] > colBlack + VAL_BORDER_ADD) {
            break;
          }
        }
        let xBorder = x;
        xLeftMin = (xBorder < xLeftMin) ? xBorder : xLeftMin;
        for (x = xMax; x > w2; x--) {
          const off = x + yOff + zOff;
          if (this.m_imageGauss[off] > colBlack + VAL_BORDER_ADD) {
            break;
          }
        }
        xBorder = x;
        xRightMax = (xBorder > xRightMax) ? xBorder : xRightMax;
      }   // for (y)
    }     // for (z)

    const NUM_512 = 512.0;
    const RANGE_SCAN = this.m_xDim * VAL_BORDER_ADD / NUM_512;

    const xLeftMax  = xLeftMin  + RANGE_SCAN;
    const xRightMin = xRightMax - RANGE_SCAN;

    // get hist
    for (i = 0; i < AV_NUM_COLORS; i++) {
      this.m_histogram[i] = 0;
    }
    let numPixHist = 0;
    for (z = zMin; z < zMax; z++) {
      const zOff = z * this.m_xDim * this.m_yDim;
      for (y = yMin; y < yMax; y++) {
        const yOff = y * this.m_xDim;
        for (x = xLeftMin; x < xLeftMax; x++) {
          const off = x + yOff + zOff;
          const val = this.m_imageGauss[off];
          this.m_histogram[val]++;
          numPixHist++;
        }
        for (x = xRightMin; x < xRightMax; x++) {
          const off = x + yOff + zOff;
          const val = Math.floor(this.m_imageGauss[off]);
          this.m_histogram[val]++;
          numPixHist++;
        }
      }   // for (y)
    }     // for (z)
    // get probabilities of each color in histogram
    for (i = 0; i < AV_NUM_COLORS; i++) {
      const h = this.m_histogram[i];
      this.m_colorProbability[i] = h / numPixHist;
    }

    // smooth prob
    const GAUSS_RAD = 12;
    const GAUSS_SIGMA = 2.6;
    ActiveVolume.smoothArray(this.m_colorProbability, AV_NUM_COLORS, GAUSS_RAD, GAUSS_SIGMA);

    let maxProb = 0.0;
    for (i = 0; i < AV_NUM_COLORS; i++) {
      maxProb = (this.m_colorProbability[i] > maxProb) ? this.m_colorProbability[i] : maxProb;
    }

    const NUM_3 = 3.0;
    const probBarrier = maxProb * 1.0 / NUM_3;
    const NUM_COLS_HALF = 128;
    for (i = 0; i < NUM_COLS_HALF; i++) {
      if (this.m_colorProbability[i] >= probBarrier) {
        break;
      }
    }
    let indBlackL = i;
    for (i += 1; i < NUM_COLS_HALF; i++) {
      // if local min
      const isLocMin = (this.m_colorProbability[i] <= this.m_colorProbability[i - 1]) &&
        (this.m_colorProbability[i] <= this.m_colorProbability[i + 1]);
      if (isLocMin) {
        break;
      }
    }
    let indBlackR = i;
    indBlackL -= TWO;
    indBlackR += TWO;

    for (i = 0; i < AV_NUM_COLORS; i++) {
      this.m_colorProbability[i] = ActiveVolume.smoothStep(indBlackL, indBlackR, i);
    }
    return 1;
  }

  /**
  * Update geometry with normals, uniformity map and colors distribution
  * @param {object} geo RederGeo to modify
  * @param {number} normalSpeed speed for increase geo size
  */
  updateGeoNormalsUniformityColors(geo, normalSpeed) {
    const numVertices = geo.getNumVertices();
    // float array
    const vertices = geo.getVertices();
    // THREE.Vector3 array
    const normals = geo.getNormals();
    const numTriangles = geo.getNumTriangles();
    // perform laplasian smoother
    // ...

    console.log(`updateGeo.NV=${numVertices},NT=${numTriangles},Sp=${normalSpeed}`);
    console.log(`updateGeo.V[0]=${vertices[0]},NV[0]=${normals[0].x}`);
  }

  /**
  * Update render geo
  * @param {object} geo RederGeo to modify
  * @param {number} method Method
  * @return {number} 1, if success. < 0, if failed
  */
  updateGeo(geo, method) {
    console.log(`updateGeo: method = ${method}`);
    if (this.m_state === AV_STATE_FINISHED) {
      return 1;
    }
    if (this.m_state === AV_STATE_NOT_STARTED) {
      // first update
      const okCreateNormals = geo.createNormalsForGeometry();
      if (okCreateNormals !== 1) {
        return okCreateNormals;
      }

      this.startImageSmooth();
      this.m_gaussStage = 0;
      this.m_state = AV_STATE_PREPARE_GAUSS;
    }
    if (this.m_state === AV_STATE_PREPARE_GAUSS) {
      const GAUSS_RAD = 2;
      const GAUSS_SIGMA = 1.8;
      const zStart  = Math.floor(this.m_zDim * (this.m_gaussStage + 0) / ACT_VOL_NUM_SMOOTH_STAGES);
      const zEnd    = Math.floor(this.m_zDim * (this.m_gaussStage + 1) / ACT_VOL_NUM_SMOOTH_STAGES);
      this.applyPartGaussSmooth(zStart, zEnd, GAUSS_RAD, GAUSS_SIGMA);

      this.m_gaussStage++;
      if (this.m_gaussStage >= ACT_VOL_NUM_SMOOTH_STAGES) {
        this.m_state = AV_STATE_PREPARE_UNIFORMITY;
        this.m_uniformityStage = 0;
      }
    }
    if (this.m_state === AV_STATE_PREPARE_UNIFORMITY) {
      // const zStart  = this.m_zDim * (this.m_uniformityStage + 0) / ACT_VOL_NUM_SMOOTH_STAGES;
      /// const zEnd    = this.m_zDim * (this.m_uniformityStage + 1) / ACT_VOL_NUM_SMOOTH_STAGES;
      // _makeUniformityImage(m_imageGauss,
      //  m_xDim, m_yDim, m_zDim, zStart, zEnd, m_imageGrad, m_imageUniformity, KOEF_UNIFORMITY);
      this.m_uniformityStage++;
      if (this.m_uniformityStage === ACT_VOL_NUM_SMOOTH_STAGES) {
        // finally get image histogram
        this.getHistogram();
        this.stopImageSmooth();
        this.m_geoStage = 0;
        this.m_state = AV_STATE_UPDATE_GEO;
      }
    }

    if (this.m_state === AV_STATE_UPDATE_GEO) {
      if (this.m_verticesNew === null) {
        const numVertices = geo.getNumVertices();
        const COORDS_IN_VERTREX = 4;
        this.m_verticesNew = new Float32Array(numVertices * COORDS_IN_VERTREX);
      }

      const updateNormals       = (method & AV_METHOD_NORMALS) !== 0;
      const updateUniformity    = (method & AV_METHOD_UNIFORMITY) !== 0;
      const updateColorKoefs    = (method & AV_METHOD_COLOR_KOEFS) !== 0;

      const  SPEED_NORMALS     = 1.1;
      if (updateNormals && !updateUniformity) {
        this.updateGeoByVertexNormals(geo, SPEED_NORMALS);
      }
      if (updateNormals && updateUniformity && !updateColorKoefs) {
        this.updateGeoByVertexNormalsAndUniformity(geo, SPEED_NORMALS);
      }
      if (updateNormals && updateUniformity && updateColorKoefs) {
        const isFinished = this.updateGeoNormalsUniformityColors(geo, SPEED_NORMALS);
        if (isFinished) {
          this.m_state = AV_STATE_FINISHED;
        }
      }
      this.m_geoStage++;
    } // if state is update geo
    return 1;
  }

} // class ActiveVolume
