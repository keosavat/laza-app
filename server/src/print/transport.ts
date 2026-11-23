// Sending raw bytes to a printer: LAN (TCP 9100) or a printer installed on the server PC (USB).
import net from 'node:net';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';

export interface Target {
  connection: 'lan' | 'usb';
  host: string;
  port: number;
  system_name: string;
}

const LAN_TIMEOUT_MS = 5000;

function friendly(e: any, t: Target): Error {
  const code = e?.code;
  if (code === 'ECONNREFUSED') return new Error(`ເຄື່ອງພິມ ${t.host}:${t.port} ປະຕິເສດການເຊື່ອມຕໍ່ (ກວດ IP ແລະ port ${t.port})`);
  if (code === 'ETIMEDOUT' || code === 'EHOSTUNREACH' || code === 'ENETUNREACH' || e?.message === 'timeout') {
    return new Error(`ຕິດຕໍ່ເຄື່ອງພິມ ${t.host} ບໍ່ໄດ້ (ກວດວ່າເປີດເຄື່ອງ ແລະ ຢູ່ Wi-Fi/LAN ດຽວກັນ)`);
  }
  return new Error(`ພິມບໍ່ສຳເລັດ: ${e?.message ?? e}`);
}

function sendLan(t: Target, bytes: Buffer): Promise<void> {
  return new Promise((resolve, reject) => {
    const sock = net.createConnection({ host: t.host, port: t.port });
    let done = false;
    const finish = (err?: Error) => {
      if (done) return;
      done = true;
      sock.destroy();
      err ? reject(friendly(err, t)) : resolve();
    };
    sock.setTimeout(LAN_TIMEOUT_MS, () => finish(new Error('timeout')));
    sock.on('error', finish);
    sock.on('connect', () => {
      sock.write(bytes, (err) => {
        if (err) return finish(err);
        // Give the printer a moment to take the data before we hang up.
        setTimeout(() => sock.end(() => finish()), 300);
      });
    });
  });
}

// Windows: write RAW data through the print spooler so any installed (USB) printer works without drivers' rendering.
const RAW_PS1 = `
param([string]$PrinterName, [string]$DataFile)
$src = @"
using System; using System.Runtime.InteropServices;
public class LazaRaw {
  [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Ansi)]
  public class DOCINFOA { [MarshalAs(UnmanagedType.LPStr)] public string pDocName; [MarshalAs(UnmanagedType.LPStr)] public string pOutputFile; [MarshalAs(UnmanagedType.LPStr)] public string pDataType; }
  [DllImport("winspool.Drv", EntryPoint="OpenPrinterA", SetLastError=true, CharSet=CharSet.Ansi, ExactSpelling=true)] public static extern bool OpenPrinter(string n, out IntPtr h, IntPtr d);
  [DllImport("winspool.Drv", EntryPoint="ClosePrinter", SetLastError=true, ExactSpelling=true)] public static extern bool ClosePrinter(IntPtr h);
  [DllImport("winspool.Drv", EntryPoint="StartDocPrinterA", SetLastError=true, CharSet=CharSet.Ansi, ExactSpelling=true)] public static extern bool StartDocPrinter(IntPtr h, Int32 level, [In, MarshalAs(UnmanagedType.LPStruct)] DOCINFOA di);
  [DllImport("winspool.Drv", EntryPoint="EndDocPrinter", SetLastError=true, ExactSpelling=true)] public static extern bool EndDocPrinter(IntPtr h);
  [DllImport("winspool.Drv", EntryPoint="StartPagePrinter", SetLastError=true, ExactSpelling=true)] public static extern bool StartPagePrinter(IntPtr h);
  [DllImport("winspool.Drv", EntryPoint="EndPagePrinter", SetLastError=true, ExactSpelling=true)] public static extern bool EndPagePrinter(IntPtr h);
  [DllImport("winspool.Drv", EntryPoint="WritePrinter", SetLastError=true, ExactSpelling=true)] public static extern bool WritePrinter(IntPtr h, IntPtr p, Int32 n, out Int32 w);
  public static string Send(string printer, byte[] bytes) {
    IntPtr h;
    if (!OpenPrinter(printer, out h, IntPtr.Zero)) return "ເປີດເຄື່ອງພິມບໍ່ໄດ້ (ຊື່ຜິດ ຫຼື ບໍ່ໄດ້ຕິດຕັ້ງ): " + printer;
    var di = new DOCINFOA(); di.pDocName = "LAZA"; di.pDataType = "RAW";
    string err = null;
    if (StartDocPrinter(h, 1, di)) {
      if (StartPagePrinter(h)) {
        IntPtr p = Marshal.AllocCoTaskMem(bytes.Length);
        Marshal.Copy(bytes, 0, p, bytes.Length);
        int w; if (!WritePrinter(h, p, bytes.Length, out w)) err = "WritePrinter failed";
        Marshal.FreeCoTaskMem(p); EndPagePrinter(h);
      } else err = "StartPagePrinter failed";
      EndDocPrinter(h);
    } else err = "StartDocPrinter failed";
    ClosePrinter(h);
    return err;
  }
}
"@
Add-Type -TypeDefinition $src
$bytes = [System.IO.File]::ReadAllBytes($DataFile)
$r = [LazaRaw]::Send($PrinterName, $bytes)
if ($r) { [Console]::Error.WriteLine($r); exit 2 }
`;

function run(cmd: string, args: string[], timeout = 30_000): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { timeout, windowsHide: true }, (err, stdout, stderr) => {
      if (err) reject(Object.assign(err, { stderr: String(stderr) }));
      else resolve({ stdout: String(stdout), stderr: String(stderr) });
    });
  });
}

async function sendUsb(t: Target, bytes: Buffer): Promise<void> {
  if (!t.system_name) throw new Error('ຍັງບໍ່ໄດ້ເລືອກເຄື່ອງພິມ USB');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'laza-print-'));
  const data = path.join(tmp, 'job.bin');
  fs.writeFileSync(data, bytes);
  try {
    if (process.platform === 'win32') {
      const ps1 = path.join(os.tmpdir(), 'laza-rawprint.ps1');
      if (!fs.existsSync(ps1) || fs.readFileSync(ps1, 'utf8') !== RAW_PS1) fs.writeFileSync(ps1, RAW_PS1);
      // Arguments are passed as an array (no shell), so the printer name cannot inject commands.
      await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', ps1, '-PrinterName', t.system_name, '-DataFile', data]);
    } else {
      await run('lp', ['-d', t.system_name, '-o', 'raw', data]);
    }
  } catch (e: any) {
    throw new Error(String(e?.stderr || e?.message || e).trim().split('\n')[0] || 'ພິມຜ່ານ USB ບໍ່ສຳເລັດ');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

export function sendBytes(t: Target, bytes: Buffer): Promise<void> {
  return t.connection === 'lan' ? sendLan(t, bytes) : sendUsb(t, bytes);
}

/** Quick reachability check without printing anything. */
export async function checkTarget(t: Target): Promise<{ ok: boolean; error?: string }> {
  try {
    if (t.connection === 'lan') {
      await new Promise<void>((resolve, reject) => {
        const s = net.createConnection({ host: t.host, port: t.port });
        s.setTimeout(2500, () => {
          s.destroy();
          reject(new Error('timeout'));
        });
        s.on('error', reject);
        s.on('connect', () => {
          s.destroy();
          resolve();
        });
      }).catch((e) => {
        throw friendly(e, t);
      });
    } else {
      const names = await listSystemPrinters();
      if (!names.includes(t.system_name)) throw new Error(`ບໍ່ພົບເຄື່ອງພິມ "${t.system_name}" ໃນເຄື່ອງນີ້`);
    }
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e.message };
  }
}

/** Printers installed on the machine running the server (for the USB dropdown). */
export async function listSystemPrinters(): Promise<string[]> {
  try {
    if (process.platform === 'win32') {
      const { stdout } = await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', 'Get-Printer | Select-Object -ExpandProperty Name | ConvertTo-Json -Compress'], 15_000);
      const v = JSON.parse(stdout.trim() || '[]');
      return (Array.isArray(v) ? v : [v]).map(String);
    }
    const { stdout } = await run('lpstat', ['-e'], 10_000);
    return stdout.split('\n').map((s) => s.trim()).filter(Boolean);
  } catch {
    return [];
  }
}
