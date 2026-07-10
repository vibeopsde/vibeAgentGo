import { describe, it, expect } from 'vitest';
import { MemoryStore } from '../src/core/memory.js';

describe('MemoryStore', () => {
  const store = new MemoryStore();

  it('writes and reads binary files', async () => {
    const data = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    await store.writeFileBinary('test.bin', data);
    const read = await store.readFileBinary('test.bin');
    expect(read).toEqual(data);
  });

  it('returns null for missing binary files', async () => {
    const read = await store.readFileBinary('nonexistent.bin');
    expect(read).toBeNull();
  });

  it('keeps text and binary storage separate for the same path', async () => {
    await store.writeFile('dual.txt', 'hello text');
    const textRead = await store.readFile('dual.txt');
    expect(textRead).toBe('hello text');
    const binaryRead = await store.readFileBinary('dual.txt');
    expect(binaryRead).toBeNull();
  });
});
