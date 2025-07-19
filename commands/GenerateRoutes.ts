import { BaseCommand } from '@adonisjs/core/ace'
import type { CommandOptions } from '@adonisjs/core/types/ace'
import type { RouteJSON } from '@adonisjs/core/types/http'
import { stubsRoot } from '../stubs/main.js'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import * as crypto from 'node:crypto'

/**
 * Configuration shape for the chimera command, typically defined
 * in config/chimera.ts
 */
type ChimeraConfig = {
  outputPath: string
  obfuscate: boolean
}

/**
 * Generates a frontend-consumable file of all named routes.
 */
export default class GenerateRoutes extends BaseCommand {
  static commandName = 'chimera:generate'
  static description = 'Generate a file with all application routes for frontend usage.'

  /**
   * The "startApp" option is crucial. It boots the AdonisJS application,
   * which ensures that all routes defined in start/routes.ts are registered
   * and available on the router service.
   */
  static options: CommandOptions = {
    startApp: true,
  }

  /**
   * Hashes a value using SHA256 for obfuscation.
   */
  private hash(value: string): string {
    return crypto.createHash('sha256').update(value).digest('hex').substring(0, 16)
  }

  /**
   * Builds a nested route map from a flat array of AdonisJS routes.
   * It also creates a name map if obfuscation is enabled.
   */
  private buildAndMapRoutes(
    routes: Pick<RouteJSON, 'name' | 'pattern'>[],
    obfuscate: boolean
  ): { routeMap: Record<string, any>; nameMap: Record<string, string> } {
    const routeMap: Record<string, any> = {}
    const nameMap: Record<string, string> = {}

    routes.forEach((route) => {
      // This should not happen due to prior filtering, but as a safeguard
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
    this.logger.info('Generating frontend routes file...')

    try {
      /**
       * Dynamically import services only when the command is executed.
       * This is a good practice to avoid potential issues during the build process.
       */
      const router = await this.app.container.make('router')
      const app = this.app

      const chimeraConfig = app.config.get('chimera', {}) as ChimeraConfig
      const outputPath = chimeraConfig.outputPath || 'resources/js/chimera.ts'
      const shouldObfuscate = chimeraConfig.obfuscate || false

      /**
       * router.toJSON() is the correct, public API to get all registered routes.
       * It returns an object where keys are domains and values are arrays of routes.
       * We flatten them into a single array for processing.
       */
      const allRoutesByDomain = router.toJSON()
      const adonisRoutes = Object.values(allRoutesByDomain).flat()

      if (adonisRoutes.length === 0) {
        this.logger.warning('No routes found in the application.')
        this.logger.warning('Please check your "start/routes.ts" file.')
        return
      }

      const namedRoutes = adonisRoutes.filter((r): r is RouteJSON & { name: string } => !!r.name)

      if (namedRoutes.length === 0) {
        this.logger.warning('No named routes found.')
        this.logger.warning(
          'Make sure to name your routes using .as("routeName") in your routes file.'
        )
        return
      }

      this.logger.info(`Found ${namedRoutes.length} named routes to process.`)

      const { routeMap, nameMap } = this.buildAndMapRoutes(namedRoutes, shouldObfuscate)

      const stubPath = join(stubsRoot, 'chimera.stub')
      let stubContent = await readFile(stubPath, 'utf-8')

      stubContent = stubContent
        .replace('// __ROUTES_PLACEHOLDER__', `routes: ${JSON.stringify(routeMap, null, 2)},`)
        .replace('// __NAME_MAP_PLACEHOLDER__', `nameMap: ${JSON.stringify(nameMap, null, 2)},`)
        .replace('// __OBFUSCATION_PLACEHOLDER__', `obfuscate: ${shouldObfuscate},`)

      const finalPath = app.makePath(outputPath)
      await mkdir(dirname(finalPath), { recursive: true })
      await writeFile(finalPath, stubContent, 'utf-8')

      this.logger.success(`Routes file generated successfully at: ${outputPath}`)
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
