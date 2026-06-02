import { spawn } from 'child_process';
import axios from 'axios';
import type { BrowserVerificationRecord, OpportunityRecord } from './types.js';
import { formatError, nowIso } from './utils.js';

export interface BrowserHarnessVerifierOptions {
  command: string;
  buName: string;
  autoStartLocalChromium: boolean;
  localChromiumCommand: string;
  cdpUrl: string;
  timeoutMs: number;
}

export class BrowserHarnessVerifier {
  private env: NodeJS.ProcessEnv;

  constructor(private readonly options: BrowserHarnessVerifierOptions) {
    this.env = {
      ...process.env,
      BU_NAME: options.buName,
    };
  }

  async prepare(): Promise<void> {
    if (this.options.autoStartLocalChromium) {
      await runCommand(this.options.localChromiumCommand, [], this.options.timeoutMs);
    }

    if (this.options.cdpUrl) {
      const websocketUrl = await resolveWebsocketUrl(this.options.cdpUrl);
      this.env = {
        ...this.env,
        BU_CDP_WS: websocketUrl,
      };
    }
  }

  async verify(opportunity: OpportunityRecord): Promise<BrowserVerificationRecord> {
    const script = buildHarnessScript(opportunity.url);

    return new Promise((resolve) => {
      const child = spawn(this.options.command, [], {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: this.env,
      });

      let stdout = '';
      let stderr = '';
      let settled = false;

      const timeout = setTimeout(() => {
        if (!settled) {
          settled = true;
          child.kill('SIGTERM');
          resolve(failure(opportunity, `browser-harness timeout after ${this.options.timeoutMs}ms`));
        }
      }, this.options.timeoutMs);

      child.stdout.on('data', (chunk) => {
        stdout += chunk.toString();
      });

      child.stderr.on('data', (chunk) => {
        stderr += chunk.toString();
      });

      child.on('error', (error) => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timeout);
        resolve(failure(opportunity, formatError(error)));
      });

      child.on('close', () => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timeout);
        resolve(parseHarnessOutput(opportunity, stdout, stderr));
      });

      child.stdin.write(script);
      child.stdin.end();
    });
  }
}

async function resolveWebsocketUrl(cdpUrl: string): Promise<string> {
  if (cdpUrl.startsWith('ws://') || cdpUrl.startsWith('wss://')) {
    return cdpUrl;
  }

  const baseUrl = cdpUrl.replace(/\/$/, '');
  const response = await axios.get(`${baseUrl}/json/version`, { timeout: 5000 });
  const websocketUrl = response.data?.webSocketDebuggerUrl;

  if (!websocketUrl) {
    throw new Error(`DevTools endpoint did not expose webSocketDebuggerUrl: ${baseUrl}`);
  }

  return websocketUrl;
}

function runCommand(command: string, args: string[], timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: process.env,
    });
    let stdout = '';
    let stderr = '';
    let settled = false;

    const timeout = setTimeout(() => {
      if (!settled) {
        settled = true;
        child.kill('SIGTERM');
        reject(new Error(`${command} timeout after ${timeoutMs}ms`));
      }
    }, timeoutMs);

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    child.on('error', (error) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      reject(error);
    });

    child.on('close', (code) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`${command} exited ${code}: ${stderr || stdout}`.trim()));
      }
    });
  });
}

function buildHarnessScript(url: string): string {
  const jsExtractor = `
(JSON.stringify((() => {
  const anchors = Array.from(document.querySelectorAll('a[href]')).slice(0, 250).map((a) => ({
    href: a.href,
    rel: a.getAttribute('rel') || '',
    text: (a.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 120)
  }));
  const text = (document.body?.innerText || '').replace(/\\s+/g, ' ').trim();
  const lowerText = text.toLowerCase();
  const loginPhrases = [
    'login required',
    'log in to continue',
    'sign in to continue',
    'please log in',
    'please login',
    'please sign in',
    'you must be logged in',
    'you need to login',
    'you need to sign in',
    'members only',
    'create an account',
    'register to submit',
    'sign up to submit',
    'log in to submit',
    'login to submit',
    'sign in to submit',
    'access denied',
    'authentication required'
  ];
  const loginUrls = anchors
    .filter((a) => /login|log-in|signin|sign-in|register|signup|sign-up|account|member|dashboard/.test((a.href + ' ' + a.text).toLowerCase()))
    .map((a) => a.href)
    .slice(0, 20);
  const loginEvidence = [];
  const phraseMatches = loginPhrases.filter((phrase) => lowerText.includes(phrase));
  loginEvidence.push(...phraseMatches.slice(0, 8));
  const passwordInputs = document.querySelectorAll('input[type="password"]').length;
  if (passwordInputs > 0) loginEvidence.push(passwordInputs + ' password input(s)');
  const loginForms = Array.from(document.querySelectorAll('form')).filter((form) => /login|log in|sign in|signin|password|email|username/.test((form.innerText || '').toLowerCase() + ' ' + Array.from(form.querySelectorAll('input, button')).map((el) => [el.name, el.id, el.placeholder, el.innerText].filter(Boolean).join(' ')).join(' ').toLowerCase())).length;
  if (loginForms > 0) loginEvidence.push(loginForms + ' login-like form(s)');
  if (loginUrls.length > 0) loginEvidence.push('login urls: ' + loginUrls.slice(0, 3).join(', '));
  const loginConfidence = Math.min(100, phraseMatches.length * 18 + (passwordInputs > 0 ? 30 : 0) + (loginForms > 0 ? 25 : 0) + (loginUrls.length > 0 ? 15 : 0));
  return {
    finalUrl: location.href,
    title: document.title,
    forms: document.querySelectorAll('form').length,
    loginRequired: loginConfidence >= 45 || phraseMatches.some((phrase) => /required|must|need|continue|submit|members only|access denied|authentication/.test(phrase)),
    loginConfidence,
    loginEvidence,
    loginUrls,
    visibleTextSample: text.slice(0, 1200),
    outboundLinks: anchors.filter((a) => {
      try { return new URL(a.href).hostname !== location.hostname; } catch { return false; }
    }).slice(0, 50),
    metaRobots: Array.from(document.querySelectorAll('meta[name="robots"], meta[name="googlebot"]')).map((m) => m.content).join(' ')
  };
})()))
`;

  return `new_tab(${JSON.stringify(url)})
wait_for_load()
print("BH_JSON:" + (js(${JSON.stringify(jsExtractor)}) or "{}"))
`;
}

function parseHarnessOutput(
  opportunity: OpportunityRecord,
  stdout: string,
  stderr: string
): BrowserVerificationRecord {
  const line = stdout
    .split(/\r?\n/)
    .find((outputLine) => outputLine.startsWith('BH_JSON:'));

  if (!line) {
    return failure(opportunity, stderr.trim() || stdout.trim() || 'browser-harness did not return verification JSON');
  }

  try {
    const parsed = JSON.parse(line.slice('BH_JSON:'.length));
    return {
      candidateId: opportunity.candidateId,
      url: opportunity.url,
      domain: opportunity.domain,
      success: true,
      verifiedAt: nowIso(),
      finalUrl: parsed.finalUrl,
      title: parsed.title,
      forms: parsed.forms,
      loginRequired: parsed.loginRequired,
      loginConfidence: parsed.loginConfidence,
      loginEvidence: parsed.loginEvidence || [],
      loginUrls: parsed.loginUrls || [],
      visibleTextSample: parsed.visibleTextSample,
      outboundLinks: parsed.outboundLinks || [],
      metaRobots: parsed.metaRobots,
    };
  } catch (error) {
    return failure(opportunity, `Failed to parse browser-harness output: ${formatError(error)}`);
  }
}

function failure(opportunity: OpportunityRecord, error: string): BrowserVerificationRecord {
  return {
    candidateId: opportunity.candidateId,
    url: opportunity.url,
    domain: opportunity.domain,
    success: false,
    verifiedAt: nowIso(),
    error,
  };
}
