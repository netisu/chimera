import { BaseCommand } from '@adonisjs/core/ace'
import type { CommandOptions } from '@adonisjs/core/types/ace'
import { stubsRoot } from '../stubs/main.js'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import * as crypto from 'node:crypto'

type ChimeraConfig = {
  outputPath: string
  obfuscate: boolean
}

export default class GenerateRoutes extends BaseCommand {
  static commandName = 'chimera:generate'
  static description = 'Generate a file with all application routes for frontend usage.'

  static options: CommandOptions = {
    startApp: true,
  }

  private hash(value: string): string {
    return crypto.createHash('sha256').update(value).digest('hex').substring(0, 16)
  }

  private buildAndMapRoutes(
    routes: any[],
    obfuscate: boolean
  ): { routeMap: Record<string, any>; nameMap: Record<string, string> } {
    const routeMap: Record<string, any> = {}
    const nameMap: Record<string, string> = {}

    routes.forEach((route) => {
      if (!route.name) {
        return
      }

      const originalName = route.name
      const keys = originalName.split('.')
      let currentLevel = routeMap
      const hashedKeys: string[] = []

      keys.forEach((key: string, index: number) => {
        const isLastKey = index === keys.length - 1
        const processedKey = obfuscate ? this.hash(key) : key
        if (obfuscate) {
          hashedKeys.push(processedKey)
        }

        if (isLastKey) {
          currentLevel[processedKey] = route.pattern
        } else {
          currentLevel[processedKey] = currentLevel[processedKey] || {}
          currentLevel = currentLevel[processedKey]
        }
      })

      if (obfuscate) {
        nameMap[originalName] = hashedKeys.join('.')
      }
    })

    return { routeMap, nameMap }
  }

  async run() {
    /**
     * Dynamically import services only when the command is executed.
     * This prevents errors during the build process (adonis-kit).
     */
    const router = await this.app.container.make('router')

    const { default: app } = await import('@adonisjs/core/services/app')

    this.logger.info('Generating frontend routes file...')

    try {
      const chimeraConfig = this.app.config.get('chimera', {}) as ChimeraConfig
      const outputPath = chimeraConfig.outputPath || 'resources/js/chimera.ts'
      const shouldObfuscate = chimeraConfig.obfuscate || false

      const allRoutesByDomain = router.toJSON()
      const adonisRoutes = Object.values(allRoutesByDomain).flat()

      // --- DEBUGGING LOGS ---
      this.logger.info(`Found ${adonisRoutes.length} total routes.`)
      const namedRoutes = adonisRoutes
        .filter((r) => r.name)
        .map((r) => ({ name: r.name, pattern: r.pattern }))

      if (namedRoutes.length > 0) {
        this.logger.success('Found the following named routes:')
        console.log(namedRoutes)
      } else {
        this.logger.warning(
          'No named routes found. Make sure to use .as("routeName") in your start/routes.ts file.'
        )
      }
      // --- END DEBUGGING LOGS ---

      const { routeMap, nameMap } = this.buildAndMapRoutes(adonisRoutes, shouldObfuscate)

      const stubPath = join(stubsRoot, 'chimera.stub')
      let stubContent = await readFile(stubPath, 'utf-8')

      stubContent = stubContent
        .replace('// __ROUTES_PLACEHOLDER__', `routes: ${JSON.stringify(routeMap, null, 2)},`)
        .replace('// __NAME_MAP_PLACEHOLDER__', `nameMap: ${JSON.stringify(nameMap, null, 2)},`)
        .replace('// __OBFUSCATION_PLACEHOLDER__', `obfuscate: ${shouldObfuscate},`)

      const finalPath = app.makePath(outputPath)
      await mkdir(dirname(finalPath), { recursive: true })
      await writeFile(finalPath, stubContent, 'utf-8')

      this.logger.success(`Routes file generated at: ${outputPath}`)
    } catch (error) {
      this.logger.error('Failed to generate routes file.')
      if (error instanceof Error) {
        this.logger.fatal(error)
      } else {
        this.logger.fatal({ message: String(error) })
      }
      this.exitCode = 1
    }
  }
}
