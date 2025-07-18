/*
|--------------------------------------------------------------------------
| Configure hook
|--------------------------------------------------------------------------
|
| The configure hook is called when someone runs "node ace configure <package>"
| command. You are free to perform any operations inside this function to
| configure the package.
|
| To make things easier, you have access to the underlying "ConfigureCommand"
| instance and you can use codemods to modify the source files.
|
*/

import { stubsRoot } from './stubs/main.js'
import type Configure from '@adonisjs/core/commands/configure'

/**
 * Configures the package
 */
export async function configure(command: Configure) {
  const codemods = await command.createCodemods()

  // Add .js extension for ESM compatibility

  /**
   * Publish config file
   */
  await codemods.makeUsingStub(stubsRoot, 'chimera.stub', {})

  /**
   * Add command to rc file
   */
  await codemods.updateRcFile((transformer: any) => {
    transformer.addCommand('@netisu/chimera/commands')
  })
}
