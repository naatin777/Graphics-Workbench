import assert from 'node:assert/strict';
import { access, readFile, stat } from 'node:fs/promises';

import { isRecord } from '../../src/application/protocols/protocol_utils.js';
import { runQpdfWithJobJson } from '../../src/operations/pdf/run_qpdf_with_job_json.js';

suite('qpdf job-json runner', () => {
  test('passwordはプロセスargvではなく一時job-jsonへ渡し、実行後に削除する', async () => {
    const password = 'secret password\nwith newline';
    let jobFilePath = '';

    await runQpdfWithJobJson({
      qpdfPath: 'fake-qpdf',
      job: {
        inputFile: '/workspace/input.pdf',
        outputFile: '/tmp/output.pdf',
        password,
        decrypt: '',
      },
      runTool: async (options) => {
        assert.equal(options.args.length, 1);
        assert.ok(!options.args.some((argument) => argument.includes(password)));
        const argument = options.args[0];
        if (argument === undefined) {
          assert.fail('job-json argument is missing');
        }
        assert.ok(argument.startsWith('--job-json-file='));
        jobFilePath = argument.slice('--job-json-file='.length);
        const job: unknown = JSON.parse(await readFile(jobFilePath, 'utf8'));
        assert.ok(isRecord(job));
        assert.equal(job.password, password);
        assert.equal(job.decrypt, '');
        if (process.platform !== 'win32') {
          assert.equal((await stat(jobFilePath)).mode & 0o777, 0o600);
        }
        return { stdout: '', stderr: '' };
      },
    });

    await assert.rejects(access(jobFilePath));
  });
});
