#!/usr/bin/env node

import { Command } from 'commander';
import { initCommand } from './cli/commands/init';
import { listCommand } from './cli/commands/list';
import { diffCommand } from './cli/commands/diff';
import { undoCommand } from './cli/commands/undo';
import { statusCommand } from './cli/commands/status';
import { taskCommand } from './cli/commands/task';
import { exportCommand } from './cli/commands/export';
import { uiCommand } from './cli/commands/ui';

const program = new Command();

program
  .name('rewind')
  .description('Agent-native version control. Auto-checkpoints every AI agent action.')
  .version('0.1.0');

program
  .command('init')
  .description('Initialize rewind in the current directory')
  .argument('[dir]', 'project directory (defaults to cwd)')
  .action((dir) => initCommand(dir));

program
  .command('list')
  .alias('ls')
  .description('List recent checkpoints')
  .option('-n, --limit <number>', 'number of checkpoints to show', '20')
  .action((options) => listCommand({ limit: parseInt(options.limit) }));

program
  .command('diff [checkpoint_id]')
  .description('Show diff for a checkpoint (defaults to latest)')
  .action((checkpointId) => diffCommand(checkpointId));

program
  .command('undo [scope]')
  .description('Rollback changes. Scope: (none)=last checkpoint, task, session')
  .action((scope) => undoCommand(scope));

program
  .command('status')
  .description('Show current rewind status')
  .action(() => statusCommand());

program
  .command('task <action> [name]')
  .description('Manage tasks. Actions: start, list, current')
  .action((action, name) => taskCommand(action, name));

program
  .command('export')
  .description('Export tasks as clean git commits')
  .option('-a, --all', 'export all tasks')
  .option('-t, --task <id>', 'export a specific task by ID')
  .action((options) => exportCommand({ all: options.all, taskId: options.task }));

program
  .command('ui')
  .description('Open the timeline web UI')
  .option('-p, --port <number>', 'port number', '3333')
  .action((options) => uiCommand({ port: options.port }));

program
  .command('setup')
  .description('Print Claude Code hook configuration')
  .action(() => {
    const hookConfig = {
      hooks: {
        PreToolUse: [
          {
            matcher: "Write|Edit|MultiEdit|Bash",
            hooks: [{
              type: "command",
              command: "node " + __dirname + "/hooks/pre-tool-use.js",
              timeout: 5
            }]
          }
        ],
        PostToolUse: [
          {
            matcher: "Write|Edit|MultiEdit|Bash",
            hooks: [{
              type: "command",
              command: "node " + __dirname + "/hooks/post-tool-use.js",
              timeout: 5
            }]
          }
        ],
        UserPromptSubmit: [
          {
            hooks: [{
              type: "command",
              command: "node " + __dirname + "/hooks/user-prompt-submit.js",
              timeout: 5
            }]
          }
        ],
        Stop: [
          {
            hooks: [{
              type: "command",
              command: "node " + __dirname + "/hooks/stop.js",
              timeout: 5
            }]
          }
        ]
      }
    };

    console.log('Add this to your ~/.claude/settings.json:\n');
    console.log(JSON.stringify(hookConfig, null, 2));
  });

program.parse();
