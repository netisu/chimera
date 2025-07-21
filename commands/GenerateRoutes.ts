import { BaseCommand, flags } from '@adonisjs/core/ace'
import type { CommandOptions } from '@adonisjs/core/types/ace'
import type { RouteJSON } from '@adonisjs/core/types/http'
import { stubsRoot } from '../stubs/main.js'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import * as crypto from 'node:crypto'

// --- START: Code adapted from RoutesListFormatter ---

/**
 * Shape of the serialized route, used for filtering and display.
 */
type SerializedRoute = {
  name: string
  pattern: string
  methods: string[]
  middleware: string[]
  handler:
    | { type: 'closure'; name: string; args?: string }
    | { type: 'controller'; moduleNameOrPath: string; method: string }
}

// --- END: Code adapted from RoutesListFormatter ---

/**
 * Configuration shape for the chimera command.
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
  static description =
    'Generate a file with all application routes for frontend usage. Provides advanced filtering.'

  static options: CommandOptions = {
    startApp: true,
  }

  // --- START: Flags adapted from RoutesListFormatter ---

  @flags.string({ description: 'Filter routes by a keyword matching name, pattern, or handler' })
  declare match?: string

  @flags.array({ description: 'Filter routes by one or more middleware' })
  declare middleware?: string[]

  @flags.array({ description: 'Ignore routes with one or more middleware' })
  declare ignoreMiddleware?: string[]

  @flags.boolean({ description: 'Display the final list of generated routes in the terminal' })
  declare display?: boolean

  // --- END: Flags ---


  /**
   * Builds a nested route map from a flat array of AdonisJS routes.
   */
  private buildAndMapRoutes(
    routes: Pick<SerializedRoute, 'name' | 'pattern'>[],
    obfuscate: boolean,
    appKey?: any
  ): { routeMap: Record<string, any>; nameMap: Record<string, string> } {
    const routeMap: Record<string, any> = {}
    const nameMap: Record<string, string> = {}

    // Hashing function that uses the APP_KEY as a salt
    const getHashedKey = (segment: string) => {
      // Create an HMAC (Hash-based Message Authentication Code)
      // This securely combines the secret key with the value to be hashed.
      return crypto.createHmac('sha256', appKey!).update(segment).digest('hex').substring(0, 8) // Keep the keys reasonably short
    }

    routes.forEach((route) => {
      if (!route.name) return

      const originalName = route.name
      const keys = originalName.split('.')
      let currentLevel = routeMap

      // Use the HMAC-hashed keys if obfuscating, otherwise use original names
      const processedKeys = obfuscate ? keys.map(getHashedKey) : keys

      processedKeys.forEach((processedKey, index) => {
        const isLastKey = index === processedKeys.length - 1
        if (isLastKey) {
          currentLevel[processedKey] = route.pattern
        } else {
          currentLevel[processedKey] = currentLevel[processedKey] || {}
          currentLevel = currentLevel[processedKey]
        }
      })

      if (obfuscate) {
        nameMap[originalName] = processedKeys.join('.')
      }
    })

    return { routeMap, nameMap }
  }
  // --- START: Methods adapted from RoutesListFormatter ---

  /**
   * Test if a route clears the applied filters.
   */
  #isAllowedByFilters(route: SerializedRoute) {
    let allowRoute = true

    if (this.middleware) {
      allowRoute = this.middleware.every((name) => {
        if (name === '*') return route.middleware.length > 0
        return route.middleware.includes(name)
      })
    }

    if (allowRoute && this.ignoreMiddleware) {
      allowRoute = this.ignoreMiddleware.every((name) => {
        if (name === '*') return route.middleware.length === 0
        return !route.middleware.includes(name)
      })
    }

    if (!allowRoute) return false
    if (!this.match) return true

    if (route.name.includes(this.match)) return true
    if (route.pattern.includes(this.match)) return true
    if (
      route.handler.type === 'controller'
        ? route.handler.moduleNameOrPath.includes(this.match)
        : route.handler.name.includes(this.match)
    ) {
      return true
    }

    return false
  }

  /**
   * Serialize route middleware to an array of names.
   */
  #serializeMiddleware(middleware: RouteJSON['middleware']): string[] {
    return [...middleware.all()].reduce<string[]>((result, one) => {
      if (typeof one === 'function') {
        result.push(one.name || 'closure')
      } else if ('name' in one && one.name) {
        result.push(one.name)
      }
      return result
    }, [])
  }

  /**
   * Serialize route handler reference to a display object.
   */
  async #serializeHandler(handler: RouteJSON['handler']): Promise<SerializedRoute['handler']> {
    if ('moduleNameOrPath' in handler && typeof handler.moduleNameOrPath === 'string') {
      return {
        type: 'controller' as const,
        moduleNameOrPath: handler.moduleNameOrPath,
        method:
          'method' in handler && typeof handler.method === 'string' ? handler.method : 'handle',
      }
    }

    // If the guard fails, it's a closure.
    return {
      type: 'closure' as const,
      name: 'name' in handler && handler.name ? handler.name : 'closure',
      args: 'listArgs' in handler ? String(handler.listArgs) : undefined,
    }
  }
  /**
   * Serializes a raw route into a simplified object for filtering and display.
   */
  async #serializeRoute(route: RouteJSON): Promise<SerializedRoute> {
    return {
      name: route.name || '',
      pattern: route.pattern,
      methods: route.methods.filter((method) => method !== 'HEAD'),
      handler: await this.#serializeHandler(route.handler),
      middleware: this.#serializeMiddleware(route.middleware),
    }
  }

  /**
   * Formats route method for display.
   */
  #formatRouteMethod(method: string) {
    return this.colors.dim(method)
  }

  /**
   * Formats route pattern for display.
   */
  #formatRoutePattern(route: SerializedRoute) {
    const pattern = route.pattern.replace(/:([^/]+)/g, (_, match) =>
      this.colors.yellow(`:${match}`)
    )
    const name = route.name ? ` ${this.colors.dim(`(${route.name})`)}` : ''
    return `${pattern}${name}`
  }

  /**
   * Formats route handler for display.
   */
  #formatHandler(route: SerializedRoute) {
    if (route.handler.type === 'controller') {
      const controller = this.colors.cyan(route.handler.moduleNameOrPath)
      const method = this.colors.cyan(route.handler.method)
      return `${controller}.${method}`
    }
    const functionName = this.colors.cyan(route.handler.name)
    const args = route.handler.args ? this.colors.dim(`(${route.handler.args})`) : ''
    return `${functionName}${args}`
  }

  /**
   * Formats route middleware for display.
   */
  #formatMiddleware(route: SerializedRoute) {
    if (route.middleware.length > 2) {
      const diff = route.middleware.length - 2
      return this.colors.dim(`${route.middleware[0]}, ${route.middleware[1]}, and ${diff} more`)
    }
    return this.colors.dim(route.middleware.join(', '))
  }

  // --- END: Adapted Methods ---

  async run() {
    this.logger.info('♻️ Generating routes file...')

    try {
      const router = await this.app.container.make('router')
      router.commit() // Ensure all routes are registered

      const app = this.app
      const chimeraConfig: ChimeraConfig = app.config.get('chimera', {})
      const outputPath = chimeraConfig.outputPath || 'resources/js/chimera.ts'
      const shouldObfuscate = chimeraConfig.obfuscate || false

      const appKey = app.config.get('app.appKey')
      if (shouldObfuscate && !appKey) {
        this.logger.error('Cannot obfuscate routes: APP_KEY is not defined in your .env file.')
        return
      }

      const allRoutesByDomain = router.toJSON()
      const adonisRoutes = Object.values(allRoutesByDomain).flat()

      // 1. Filter for named routes first, as they are the only ones we care about.
      const namedRoutes = adonisRoutes.filter((r): r is RouteJSON & { name: string } => !!r.name)
      if (namedRoutes.length === 0) {
        this.logger.warning('No named routes found to process.')
        return
      }

      // 2. Serialize and apply advanced filters from command flags.
      const processedRoutes: SerializedRoute[] = []
      for (const route of namedRoutes) {
        const serializedRoute = await this.#serializeRoute(route)
        if (this.#isAllowedByFilters(serializedRoute)) {
          processedRoutes.push(serializedRoute)
        }
      }

      if (processedRoutes.length === 0) {
        this.logger.warning('No named routes matched the provided filters.')
        return
      }

      this.logger.info(`Found ${processedRoutes.length} named routes to process.`)

      // 3. Build the route map for the file.
      const { routeMap, nameMap } = this.buildAndMapRoutes(processedRoutes, shouldObfuscate, appKey)

      // 4. Generate the file from the stub.
      const stubPath = join(stubsRoot, 'chimera.stub')
      let stubContent = await readFile(stubPath, 'utf-8')
      stubContent = stubContent
        .replace('// __ROUTES_PLACEHOLDER__', `routes: ${JSON.stringify(routeMap, null, 2)},`)
        .replace('// __NAME_MAP_PLACEHOLDER__', `nameMap: ${JSON.stringify(nameMap, null, 2)},`)
        .replace('// __OBFUSCATION_PLACEHOLDER__', `obfuscate: ${shouldObfuscate},`)

      const finalPath = app.makePath(outputPath)
      await mkdir(dirname(finalPath), { recursive: true })
      await writeFile(finalPath, stubContent, 'utf-8')

      // 5. If --display flag is used, print the table to the console.
      if (this.display) {
        this.logger.info('Displaying generated routes:')
        const table = this.ui
          .table()
          .head([
            this.colors.dim('METHOD'),
            this.colors.dim('ROUTE'),
            { hAlign: 'right', content: this.colors.dim('HANDLER') },
            { hAlign: 'right', content: this.colors.dim('MIDDLEWARE') },
          ])

        processedRoutes.forEach((route) => {
          route.methods.forEach((method) => {
            table.row([
              this.#formatRouteMethod(method),
              this.#formatRoutePattern(route),
              { hAlign: 'right', content: this.#formatHandler(route) },
              { hAlign: 'right', content: this.#formatMiddleware(route) },
            ])
          })
        })
        table.render()
      }

      this.logger.success(`🎉 Routes file generated successfully at: ${outputPath}`)
    } catch (error) {
      this.logger.error('🚨 Failed to generate routes file.')
      if (error instanceof Error) {
        this.logger.fatal(error)
      } else {
        this.logger.fatal({ message: String(error) })
      }
      this.exitCode = 1
    }
  }
}
