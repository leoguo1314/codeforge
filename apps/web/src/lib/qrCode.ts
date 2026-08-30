type QrBlock = { total: number; data: number };

const QR_L_BLOCKS: Readonly<Record<number, readonly QrBlock[]>> = {
  1: [{ total: 26, data: 19 }],
  2: [{ total: 44, data: 34 }],
  3: [{ total: 70, data: 55 }],
  4: [{ total: 100, data: 80 }],
  5: [{ total: 134, data: 108 }],
  6: [
    { total: 86, data: 68 },
    { total: 86, data: 68 },
  ],
  7: [
    { total: 98, data: 78 },
    { total: 98, data: 78 },
  ],
  8: [
    { total: 121, data: 97 },
    { total: 121, data: 97 },
  ],
  9: [
    { total: 146, data: 116 },
    { total: 146, data: 116 },
  ],
  10: [
    { total: 86, data: 68 },
    { total: 86, data: 68 },
    { total: 87, data: 69 },
    { total: 87, data: 69 },
  ],
};

const ALIGNMENT_PATTERN_POSITIONS: Readonly<Record<number, readonly number[]>> = {
  1: [],
  2: [6, 18],
  3: [6, 22],
  4: [6, 26],
  5: [6, 30],
  6: [6, 34],
  7: [6, 22, 38],
  8: [6, 24, 42],
  9: [6, 26, 46],
  10: [6, 28, 50],
};

const GF_EXP = new Uint8Array(512);
const GF_LOG = new Uint8Array(256);
let gfValue = 1;
for (let index = 0; index < 255; index += 1) {
  GF_EXP[index] = gfValue;
  GF_LOG[gfValue] = index;
  gfValue <<= 1;
  if (gfValue & 0x100) gfValue ^= 0x11d;
}
for (let index = 255; index < GF_EXP.length; index += 1) {
  GF_EXP[index] = GF_EXP[index - 255];
}

class BitBuffer {
  private readonly bits: boolean[] = [];

  get length(): number {
    return this.bits.length;
  }

  put(value: number, length: number): void {
    for (let bit = length - 1; bit >= 0; bit -= 1) {
      this.bits.push(((value >>> bit) & 1) === 1);
    }
  }

  toBytes(): number[] {
    const bytes = Array.from({ length: Math.ceil(this.bits.length / 8) }, () => 0);
    for (let index = 0; index < this.bits.length; index += 1) {
      if (this.bits[index]) bytes[index >>> 3] |= 0x80 >>> (index & 7);
    }
    return bytes;
  }
}

function multiplyPoly(left: number[], right: number[]): number[] {
  const result = Array.from({ length: left.length + right.length - 1 }, () => 0);
  for (let leftIndex = 0; leftIndex < left.length; leftIndex += 1) {
    for (let rightIndex = 0; rightIndex < right.length; rightIndex += 1) {
      const leftValue = left[leftIndex];
      const rightValue = right[rightIndex];
      if (leftValue === 0 || rightValue === 0) continue;
      result[leftIndex + rightIndex] ^=
        GF_EXP[(GF_LOG[leftValue] + GF_LOG[rightValue]) % 255];
    }
  }
  return result;
}

function generatorPolynomial(ecCount: number): number[] {
  let generator = [1];
  for (let index = 0; index < ecCount; index += 1) {
    generator = multiplyPoly(generator, [1, GF_EXP[index]]);
  }
  return generator;
}

function reedSolomon(data: readonly number[], ecCount: number): number[] {
  const generator = generatorPolynomial(ecCount);
  const remainder = Array.from({ length: ecCount }, () => 0);

  for (const byte of data) {
    const factor = byte ^ remainder[0];
    remainder.shift();
    remainder.push(0);
    if (factor === 0) continue;
    const factorLog = GF_LOG[factor];
    for (let index = 0; index < ecCount; index += 1) {
      const coefficient = generator[index + 1];
      if (coefficient === 0) continue;
      remainder[index] ^= GF_EXP[(factorLog + GF_LOG[coefficient]) % 255];
    }
  }

  return remainder;
}

function createDataCodewords(text: string, version: number, blocks: readonly QrBlock[]): number[] {
  const payload = Array.from(new TextEncoder().encode(text));
  const totalDataCodewords = blocks.reduce((sum, block) => sum + block.data, 0);
  const capacityBits = totalDataCodewords * 8;
  const lengthBits = version < 10 ? 8 : 16;
  if (payload.length >= 1 << lengthBits) {
    throw new Error("Pairing payload is too long for the built-in QR encoder.");
  }

  const buffer = new BitBuffer();
  buffer.put(0b0100, 4); // Byte mode.
  buffer.put(payload.length, lengthBits);
  for (const byte of payload) buffer.put(byte, 8);

  if (buffer.length > capacityBits) {
    throw new Error("Pairing payload is too long for the built-in QR encoder.");
  }

  buffer.put(0, Math.min(4, capacityBits - buffer.length));
  while (buffer.length % 8 !== 0) buffer.put(0, 1);

  const bytes = buffer.toBytes();
  let padIndex = 0;
  while (bytes.length < totalDataCodewords) {
    bytes.push(padIndex % 2 === 0 ? 0xec : 0x11);
    padIndex += 1;
  }
  return bytes;
}

function createCodewords(text: string, version: number, blocks: readonly QrBlock[]): number[] {
  const source = createDataCodewords(text, version, blocks);
  const dataBlocks: number[][] = [];
  const errorBlocks: number[][] = [];
  let offset = 0;

  for (const block of blocks) {
    const data = source.slice(offset, offset + block.data);
    offset += block.data;
    dataBlocks.push(data);
    errorBlocks.push(reedSolomon(data, block.total - block.data));
  }

  const result: number[] = [];
  const maxData = Math.max(...dataBlocks.map((block) => block.length));
  const maxError = Math.max(...errorBlocks.map((block) => block.length));

  for (let index = 0; index < maxData; index += 1) {
    for (const block of dataBlocks) {
      if (index < block.length) result.push(block[index]);
    }
  }
  for (let index = 0; index < maxError; index += 1) {
    for (const block of errorBlocks) {
      if (index < block.length) result.push(block[index]);
    }
  }
  return result;
}

function bchRemainder(value: number, polynomial: number): number {
  let remainder = value;
  const polynomialDegree = 31 - Math.clz32(polynomial);
  while (remainder !== 0 && 31 - Math.clz32(remainder) >= polynomialDegree) {
    remainder ^= polynomial << (31 - Math.clz32(remainder) - polynomialDegree);
  }
  return remainder;
}

function formatBits(mask: number): number {
  // QR error-correction level L uses format bits 01.
  const data = (0b01 << 3) | mask;
  return ((data << 10) | bchRemainder(data << 10, 0x537)) ^ 0x5412;
}

function versionBits(version: number): number {
  return (version << 12) | bchRemainder(version << 12, 0x1f25);
}

function setFinder(matrix: (boolean | null)[][], row: number, column: number): void {
  const size = matrix.length;
  for (let rowOffset = -1; rowOffset <= 7; rowOffset += 1) {
    for (let columnOffset = -1; columnOffset <= 7; columnOffset += 1) {
      const targetRow = row + rowOffset;
      const targetColumn = column + columnOffset;
      if (targetRow < 0 || targetRow >= size || targetColumn < 0 || targetColumn >= size) continue;
      const black =
        rowOffset >= 0 &&
        rowOffset <= 6 &&
        columnOffset >= 0 &&
        columnOffset <= 6 &&
        (rowOffset === 0 ||
          rowOffset === 6 ||
          columnOffset === 0 ||
          columnOffset === 6 ||
          (rowOffset >= 2 && rowOffset <= 4 && columnOffset >= 2 && columnOffset <= 4));
      matrix[targetRow][targetColumn] = black;
    }
  }
}

function setAlignmentPatterns(matrix: (boolean | null)[][], version: number): void {
  const positions = ALIGNMENT_PATTERN_POSITIONS[version];
  for (const row of positions) {
    for (const column of positions) {
      if (matrix[row][column] !== null) continue;
      for (let rowOffset = -2; rowOffset <= 2; rowOffset += 1) {
        for (let columnOffset = -2; columnOffset <= 2; columnOffset += 1) {
          matrix[row + rowOffset][column + columnOffset] =
            Math.max(Math.abs(rowOffset), Math.abs(columnOffset)) !== 1;
        }
      }
    }
  }
}

function setTimingPatterns(matrix: (boolean | null)[][]): void {
  const size = matrix.length;
  for (let index = 8; index < size - 8; index += 1) {
    if (matrix[index][6] === null) matrix[index][6] = index % 2 === 0;
    if (matrix[6][index] === null) matrix[6][index] = index % 2 === 0;
  }
}

function setFormatInfo(matrix: (boolean | null)[][], mask: number): void {
  const size = matrix.length;
  const bits = formatBits(mask);
  for (let index = 0; index < 15; index += 1) {
    const black = ((bits >>> index) & 1) === 1;
    if (index < 6) matrix[index][8] = black;
    else if (index < 8) matrix[index + 1][8] = black;
    else matrix[size - 15 + index][8] = black;

    if (index < 8) matrix[8][size - index - 1] = black;
    else if (index === 8) matrix[8][7] = black;
    else matrix[8][15 - index - 1] = black;
  }
  matrix[size - 8][8] = true;
}

function setVersionInfo(matrix: (boolean | null)[][], version: number): void {
  if (version < 7) return;
  const size = matrix.length;
  const bits = versionBits(version);
  for (let index = 0; index < 18; index += 1) {
    const black = ((bits >>> index) & 1) === 1;
    matrix[Math.floor(index / 3)][(index % 3) + size - 11] = black;
    matrix[(index % 3) + size - 11][Math.floor(index / 3)] = black;
  }
}

function maskBit(row: number, column: number, mask: number): boolean {
  switch (mask) {
    case 0:
      return (row + column) % 2 === 0;
    case 1:
      return row % 2 === 0;
    case 2:
      return column % 3 === 0;
    case 3:
      return (row + column) % 3 === 0;
    case 4:
      return (Math.floor(row / 2) + Math.floor(column / 3)) % 2 === 0;
    case 5:
      return ((row * column) % 2) + ((row * column) % 3) === 0;
    case 6:
      return (((row * column) % 2) + ((row * column) % 3)) % 2 === 0;
    case 7:
      return (((row * column) % 3) + ((row + column) % 2)) % 2 === 0;
    default:
      return false;
  }
}

function mapCodewords(matrix: (boolean | null)[][], codewords: readonly number[], mask: number): void {
  const size = matrix.length;
  let byteIndex = 0;
  let bitIndex = 7;
  let upward = true;

  for (let right = size - 1; right > 0; right -= 2) {
    if (right === 6) right -= 1;
    for (let verticalIndex = 0; verticalIndex < size; verticalIndex += 1) {
      const row = upward ? size - 1 - verticalIndex : verticalIndex;
      for (let offset = 0; offset < 2; offset += 1) {
        const column = right - offset;
        if (matrix[row][column] !== null) continue;
        let black = false;
        if (byteIndex < codewords.length) {
          black = ((codewords[byteIndex] >>> bitIndex) & 1) === 1;
        }
        if (maskBit(row, column, mask)) black = !black;
        matrix[row][column] = black;
        bitIndex -= 1;
        if (bitIndex < 0) {
          byteIndex += 1;
          bitIndex = 7;
        }
      }
    }
    upward = !upward;
  }
}

function penaltyScore(matrix: readonly (readonly boolean[])[]): number {
  const size = matrix.length;
  let score = 0;

  const scoreLine = (values: readonly boolean[]) => {
    let runLength = 1;
    for (let index = 1; index < values.length; index += 1) {
      if (values[index] === values[index - 1]) {
        runLength += 1;
        if (runLength === 5) score += 3;
        else if (runLength > 5) score += 1;
      } else {
        runLength = 1;
      }
    }
  };

  for (let row = 0; row < size; row += 1) scoreLine(matrix[row]);
  for (let column = 0; column < size; column += 1) {
    scoreLine(matrix.map((row) => row[column]));
  }

  for (let row = 0; row < size - 1; row += 1) {
    for (let column = 0; column < size - 1; column += 1) {
      const value = matrix[row][column];
      if (
        value === matrix[row + 1][column] &&
        value === matrix[row][column + 1] &&
        value === matrix[row + 1][column + 1]
      ) {
        score += 3;
      }
    }
  }

  const finderPattern = [true, false, true, true, true, false, true];
  const quiet = [false, false, false, false];
  const hasPattern = (line: readonly boolean[]) => {
    for (let start = 0; start <= line.length - 11; start += 1) {
      const window = line.slice(start, start + 11);
      const left = [...finderPattern, ...quiet];
      const right = [...quiet, ...finderPattern];
      if (window.every((value, index) => value === left[index])) score += 40;
      if (window.every((value, index) => value === right[index])) score += 40;
    }
  };
  for (let row = 0; row < size; row += 1) hasPattern(matrix[row]);
  for (let column = 0; column < size; column += 1) {
    hasPattern(matrix.map((row) => row[column]));
  }

  const dark = matrix.flat().filter(Boolean).length;
  score += Math.floor(Math.abs((dark * 100) / (size * size) - 50) / 5) * 10;
  return score;
}

function buildMatrix(text: string, version: number, mask: number): boolean[][] {
  const blocks = QR_L_BLOCKS[version];
  const size = version * 4 + 17;
  const matrix: (boolean | null)[][] = Array.from({ length: size }, () =>
    Array.from({ length: size }, () => null),
  );

  setFinder(matrix, 0, 0);
  setFinder(matrix, size - 7, 0);
  setFinder(matrix, 0, size - 7);
  setAlignmentPatterns(matrix, version);
  setTimingPatterns(matrix);
  setFormatInfo(matrix, mask);
  setVersionInfo(matrix, version);
  mapCodewords(matrix, createCodewords(text, version, blocks), mask);

  return matrix.map((row) => row.map((value) => value === true));
}

function fitsVersion(text: string, version: number): boolean {
  try {
    createDataCodewords(text, version, QR_L_BLOCKS[version]);
    return true;
  } catch {
    return false;
  }
}

export function createQrMatrix(text: string): boolean[][] {
  if (!text) throw new Error("QR payload is empty.");

  let version = 1;
  while (version <= 10 && !fitsVersion(text, version)) version += 1;
  if (version > 10) {
    throw new Error("Pairing link is too long for the built-in QR renderer. Copy the link instead.");
  }

  let bestMatrix: boolean[][] | null = null;
  let bestPenalty = Number.POSITIVE_INFINITY;
  for (let mask = 0; mask < 8; mask += 1) {
    const candidate = buildMatrix(text, version, mask);
    const penalty = penaltyScore(candidate);
    if (penalty < bestPenalty) {
      bestPenalty = penalty;
      bestMatrix = candidate;
    }
  }

  if (!bestMatrix) throw new Error("Could not generate QR code.");
  return bestMatrix;
}

export function qrMatrixToPath(matrix: readonly (readonly boolean[])[], quietZone = 4): {
  path: string;
  viewBoxSize: number;
} {
  const commands: string[] = [];
  for (let row = 0; row < matrix.length; row += 1) {
    let column = 0;
    while (column < matrix.length) {
      if (!matrix[row][column]) {
        column += 1;
        continue;
      }
      const start = column;
      while (column < matrix.length && matrix[row][column]) column += 1;
      commands.push(`M${start + quietZone} ${row + quietZone}h${column - start}v1H${start + quietZone}z`);
    }
  }
  return {
    path: commands.join(""),
    viewBoxSize: matrix.length + quietZone * 2,
  };
}
