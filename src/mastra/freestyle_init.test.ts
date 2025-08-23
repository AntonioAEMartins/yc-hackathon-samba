import { vi, expect, describe, it, beforeEach, afterEach } from 'vitest';

vi.mock('freestyle-sandboxes', () => {
  return {
    FreestyleSandboxes: vi.fn().mockImplementation(() => ({
      fetch: vi.fn(),
      createGitRepository: vi.fn(),
      requestDevServer: vi.fn(),
    })),
  };
});

import { FreestyleSandboxes } from 'freestyle-sandboxes';
import * as moduleUnderTest from './freestyle_init';

const mockedFreestyle = vi.mocked(FreestyleSandboxes, true);

describe('freestyle_init module', () => {
  let freestyleInstance: any;
  const originalEnv = process.env;
  const consoleLog = console.log;
  const consoleError = console.error;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...originalEnv };
    freestyleInstance = new (FreestyleSandboxes as any)();
    // Replace the internal freestyle instance in module with our mocked instance
    (moduleUnderTest as any).freestyle = freestyleInstance;
    console.log = vi.fn();
    console.error = vi.fn();
  });

  afterEach(() => {
    process.env = originalEnv;
    console.log = consoleLog;
    console.error = consoleError;
  });

  describe('execAndLog', () => {
    it('should call process.exec with provided cmd and background flag and return result when stdout and stderr are empty', async () => {
      const fakeProc = { exec: vi.fn().mockResolvedValue({ id: '1', isNew: false }) };
      const res = await (moduleUnderTest as any).execAndLog(fakeProc, 'echo hi', true);
      expect(fakeProc.exec).toHaveBeenCalledWith('echo hi', true);
      expect(res).toEqual({ id: '1', isNew: false });
      expect(console.log).toHaveBeenCalled();
    });

    it('should log stdout lines when result.stdout contains lines', async () => {
      const fakeProc = { exec: vi.fn().mockResolvedValue({ id: '2', isNew: true, stdout: ['a','b'] }) };
      await (moduleUnderTest as any).execAndLog(fakeProc, 'ls');
      expect(console.log).toHaveBeenCalledWith('a\nb');
    });

    it('should log stderr lines when result.stderr contains lines', async () => {
      const fakeProc = { exec: vi.fn().mockResolvedValue({ id: '3', isNew: false, stderr: ['err1'] }) };
      await (moduleUnderTest as any).execAndLog(fakeProc, 'cmd');
      expect(console.error).toHaveBeenCalledWith('err1');
    });

    it('should include run id and isNew in the console output', async () => {
      const fakeProc = { exec: vi.fn().mockResolvedValue({ id: '42', isNew: true }) };
      await (moduleUnderTest as any).execAndLog(fakeProc, 'noop');
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('run id: 42'));
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('new: true'));
    });

    it('should propagate rejected promise from process.exec (error path)', async () => {
      const err = new Error('fail');
      const fakeProc = { exec: vi.fn().mockRejectedValue(err) };
      await expect((moduleUnderTest as any).execAndLog(fakeProc, 'bad')).rejects.toThrow('fail');
    });
  });

  describe('generateEnvFileContents', () => {
    it('should return joined env lines and trailing newline for present keys', () => {
      process.env.DATABASE_URL = 'postgres://x';
      process.env.DIRECT_URL = 'direct';
      const out = (moduleUnderTest as any).generateEnvFileContents();
      expect(out).toContain('DATABASE_URL=postgres://x');
      expect(out).toContain('DIRECT_URL=direct');
      expect(out.endsWith('\n')).toBe(true);
    });

    it('should omit keys missing from process.env and still return trailing newline', () => {
      delete process.env.DATABASE_URL;
      process.env.SENTRY_DSN = 'dsn';
      const out = (moduleUnderTest as any).generateEnvFileContents();
      expect(out).toContain('SENTRY_DSN=dsn');
      expect(out.endsWith('\n')).toBe(true);
    });

    it('should return only newline when none of the expected env keys are present', () => {
      for (const k of ['DATABASE_URL','DIRECT_URL','SENTRY_AUTH_TOKEN','SENTRY_ORG','SENTRY_PROJECT','SENTRY_DSN','ALERT_INTEGRATION_NAME','WEBHOOK_SECRET']) delete process.env[k];
      const out = (moduleUnderTest as any).generateEnvFileContents();
      expect(out).toBe('\n');
    });

    it('should include exact key=value formatting for keys set in process.env', () => {
      process.env.WEBHOOK_SECRET = 's3cr3t';
      const out = (moduleUnderTest as any).generateEnvFileContents();
      expect(out).toBe(expect.stringContaining('WEBHOOK_SECRET=s3cr3t'));
    });
  });

  describe('execViaApi', () => {
    it('should post to freestyle.fetch endpoint and return normalized result when response is ok', async () => {
      const mockRes = {
        ok: true,
        json: vi.fn().mockResolvedValue({ id: 'x', isNew: false, stdout: ['o'], stderr: ['e'] }),
      };
      freestyleInstance.fetch.mockResolvedValue(mockRes);
      const result = await (moduleUnderTest as any).execViaApi({ repoId: 'r', kind: 'repo' }, 'cmd');
      expect(freestyleInstance.fetch).toHaveBeenCalled();
      expect(result).toEqual({ id: 'x', isNew: false, stdout: ['o'], stderr: ['e'] });
    });

    it('should throw an Error with status and body when response.ok is false', async () => {
      const mockRes = { ok: false, status: 500, statusText: 'err', text: vi.fn().mockResolvedValue('body') };
      freestyleInstance.fetch.mockResolvedValue(mockRes);
      await expect((moduleUnderTest as any).execViaApi({ repoId: 'r', kind: 'repo' }, 'cmd')).rejects.toThrow(/Exec API failed/);
    });

    it('should map response.json() fields (id, isNew, stdout, stderr) to the expected return structure', async () => {
      const mockRes = { ok: true, json: vi.fn().mockResolvedValue({ id: 'i', isNew: true }) };
      freestyleInstance.fetch.mockResolvedValue(mockRes);
      const out = await (moduleUnderTest as any).execViaApi({ repoId: 'r', kind: 'repo' }, 'c');
      expect(out.id).toBe('i');
      expect(out.isNew).toBe(true);
      expect(out.stdout).toBeUndefined();
      expect(out.stderr).toBeUndefined();
    });

    it('should handle absence of stdout/stderr in response by returning undefined for those fields', async () => {
      const mockRes = { ok: true, json: vi.fn().mockResolvedValue({ id: 'y', isNew: false }) };
      freestyleInstance.fetch.mockResolvedValue(mockRes);
      const out = await (moduleUnderTest as any).execViaApi({ repoId: 'r', kind: 'repo' }, 'c');
      expect(out.stdout).toBeUndefined();
      expect(out.stderr).toBeUndefined();
    });

    it('should propagate network/fetch rejections', async () => {
      freestyleInstance.fetch.mockRejectedValue(new Error('netfail'));
      await expect((moduleUnderTest as any).execViaApi({ repoId: 'r', kind: 'repo' }, 'c')).rejects.toThrow('netfail');
    });
  });

  describe('initFreestyleSandbox', () => {
    it('should call freestyle.createGitRepository and freestyle.requestDevServer then execute a sequence of commands via execAndLog and return ephemeralUrl', async () => {
      const repoId = 'repo123';
      freestyleInstance.createGitRepository.mockResolvedValue({ repoId });
      freestyleInstance.requestDevServer.mockResolvedValue({ ephemeralUrl: 'https://e' });

      // spy on execAndLog to ensure calls
      const spy = vi.spyOn(moduleUnderTest as any, 'execAndLog').mockResolvedValue({ id: 'i', isNew: false });

      const url = await (moduleUnderTest as any).initFreestyleSandbox();
      expect(freestyleInstance.createGitRepository).toHaveBeenCalled();
      expect(freestyleInstance.requestDevServer).toHaveBeenCalledWith({ repoId });
      expect(spy).toHaveBeenCalled();
      expect(url).toBe('https://e');

      spy.mockRestore();
    });

    it('should build a repo name plus call createGitRepository with expected import object shape', async () => {
      freestyleInstance.createGitRepository.mockResolvedValue({ repoId: 'r' });
      freestyleInstance.requestDevServer.mockResolvedValue({ ephemeralUrl: 'u' });
      const spy = vi.spyOn(freestyleInstance, 'createGitRepository');
      const guard = await (moduleUnderTest as any).initFreestyleSandbox();
      expect(spy).toHaveBeenCalledWith(expect.objectContaining({ import: expect.objectContaining({ type: 'git', url: expect.any(String) }) }));
      expect(guard).toBe('u');
      spy.mockRestore();
    });

    it('should call execAndLog for cd, git checkout, writing .env and restarting service with correct commands', async () => {
      freestyleInstance.createGitRepository.mockResolvedValue({ repoId: 'r' });
      freestyleInstance.requestDevServer.mockResolvedValue({ ephemeralUrl: 'u' });
      const execSpy = vi.spyOn(moduleUnderTest as any, 'execAndLog').mockResolvedValue({ id: 'x', isNew: false });
      await (moduleUnderTest as any).initFreestyleSandbox();
      expect(execSpy).toHaveBeenCalledWith(expect.any(Object), 'cd /template');
      expect(execSpy).toHaveBeenCalledWith(expect.any(Object), 'git checkout dev');
      expect(execSpy).toHaveBeenCalledWith(expect.any(Object), expect.stringContaining('echo'));
      expect(execSpy).toHaveBeenCalledWith(expect.any(Object), 'systemctl restart freestyle-run-dev');
      execSpy.mockRestore();
    });

    it('should propagate errors from createGitRepository or requestDevServer', async () => {
      freestyleInstance.createGitRepository.mockRejectedValue(new Error('create fail'));
      await expect((moduleUnderTest as any).initFreestyleSandbox()).rejects.toThrow('create fail');
      freestyleInstance.createGitRepository.mockResolvedValue({ repoId: 'r' });
      freestyleInstance.requestDevServer.mockRejectedValue(new Error('req fail'));
      await expect((moduleUnderTest as any).initFreestyleSandbox()).rejects.toThrow('req fail');
    });

    it('should handle exec errors thrown from execAndLog and propagate them', async () => {
      freestyleInstance.createGitRepository.mockResolvedValue({ repoId: 'r' });
      freestyleInstance.requestDevServer.mockResolvedValue({ ephemeralUrl: 'u' });
      vi.spyOn(moduleUnderTest as any, 'execAndLog').mockRejectedValue(new Error('exec fail'));
      await expect((moduleUnderTest as any).initFreestyleSandbox()).rejects.toThrow('exec fail');
    });
  });
});
