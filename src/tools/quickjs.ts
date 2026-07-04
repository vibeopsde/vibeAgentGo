// ============================================================
// HAG — QuickJS Sandbox (run_code tool)
// ============================================================

import { getQuickJS } from 'quickjs-emscripten';

export async function quickjsEval(
  code: string,
  env: { workspace: string; env: Record<string, string> }
): Promise<string> {
  const QuickJS = await getQuickJS();
  const runtime = QuickJS.newRuntime();
  const vm = runtime.newContext();

  const logs: string[] = [];
  const logFn = vm.newFunction('log', (...args: any[]) => {
    const parts = args.map(a => {
      try {
        return vm.typeof(a) === 'string' ? vm.getString(a) : JSON.stringify(vm.dump(a));
      } catch { return String(a); }
    });
    logs.push(parts.join(' '));
    return vm.undefined;
  });

  vm.setProp(vm.global, 'log', logFn);

  const consoleObj = vm.newObject();
  vm.setProp(consoleObj, 'log', logFn);
  vm.setProp(vm.global, 'console', consoleObj);

  vm.setProp(vm.global, '__workspace', vm.newString(env.workspace));

  let output = '';

  try {
    const result = await vm.evalCode(code) as any;
    if (result.error) {
      // Try to extract .message property from error object
      let err: any;
      try {
        const msgHandle = vm.getProp(result.error, 'message');
        err = vm.getString(msgHandle) || vm.dump(result.error);
        msgHandle.dispose();
      } catch {
        err = vm.dump(result.error);
      }
      result.error.dispose();
      output = `Error: ${err}\n\nLogs:\n${logs.length ? logs.join('\n') : '(none)'}`;
    } else {
      const val = vm.dump(result.value);
      result.value.dispose();
      const resultStr = val === undefined ? 'undefined' : typeof val === 'string' ? val : JSON.stringify(val, null, 2);
      output = `Result: ${resultStr}\n\nLogs:\n${logs.length ? logs.join('\n') : '(none)'}`;
    }
  } catch (e: any) {
    output = `Sandbox error: ${e.message}\n\nLogs:\n${logs.length ? logs.join('\n') : '(none)'}`;
  } finally {
    // Dispose all handles before freeing runtime
    logFn.dispose();
    consoleObj.dispose();
    vm.dispose();
    runtime.dispose();
  }

  return output;
}