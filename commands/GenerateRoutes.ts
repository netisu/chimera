import { BaseCommand, flags } from '@adonisjs/core/ace'
import type { CommandOptions } from '@adonisjs/core/types/ace'
import type { RouteJSON } from '@adonisjs/core/types/http'
import JavaScriptObfuscator from 'javascript-obfuscator'
import { Secret } from '@adonisjs/core/helpers'
import { writeFile, mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'
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
    appKey?: string
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

  async run() {
    this.logger.info('♻️ Generating routes file...')

    try {
      // --- 1. Get All Necessary Data ---
      const router = await this.app.container.make('router')
      router.commit()

      const app = this.app
      const chimeraConfig: ChimeraConfig = app.config.get('chimera', {})
      const outputPath = chimeraConfig.outputPath || 'resources/js/chimera.ts'
      const shouldObfuscate = chimeraConfig.obfuscate || false

      const allRoutesByDomain = router.toJSON()
      const adonisRoutes = Object.values(allRoutesByDomain).flat()
      const namedRoutes = adonisRoutes.filter((r): r is RouteJSON & { name: string } => !!r.name)

      if (namedRoutes.length === 0) {
        this.logger.warning('No named routes found to process.')
        return
      }

      // --- 2. Build the Raw Route Map ---
      // We build the map with plain names because the entire code will be obfuscated later.
      const { routeMap, nameMap } = this.buildAndMapRoutes(namedRoutes, false)

      // --- 3. Construct the Final JavaScript Code as a String ---
      // This string is a template of the final chimera.ts file.
      const rawJavaScriptCode = `
        const Chimera = {
          routes: ${JSON.stringify(routeMap, null, 2)},
          nameMap: ${JSON.stringify(nameMap, null, 2)},
          obfuscate: false, // The client-side flag is always false

          route(name, params={}, queryParams={}) {
            if (typeof name !== "string") {
              console.error("[Chimera] Invalid route name. Expected a string, but got:", name);
              return "";
            }
            const keys = name.split(".");
            let pattern = this.routes;
            for (const key of keys) {
              if (pattern && typeof pattern === "object" && key in pattern) {
                pattern = pattern[key];
              } else {
                pattern = undefined;
                break;
              }
            }
            if (typeof pattern !== "string") {
              console.error('[Chimera] Route "' + name + '" could not be found.');
              return "";
            }
            let url = pattern;
            for (const key in params) {
              url = url.replace(":" + key, String(params[key]));
            }
            const searchParams = new URLSearchParams();
            for (const key in queryParams) {
              const value = queryParams[key];
              if (value !== null && value !== undefined) {
                searchParams.append(key, String(value));
              }
            }
            const queryString = searchParams.toString();
            return queryString ? url + "?" + queryString : url;
          },

          current(routeName) {
            if (typeof window === "undefined") return false;
            const urlPattern = this.route(routeName);
            if (!urlPattern) return false;
            const regexPattern = "^" + urlPattern.replace(/:[^\\s/]+/g, "([^/]+)").replace(/\\//g, "\\\\/") + "$";
            const regex = new RegExp(regexPattern);
            return regex.test(window.location.pathname);
          },
        };
        export default Chimera;
      `

      let finalCode = rawJavaScriptCode

      // --- 4. Obfuscate the Code (if enabled) ---
      if (shouldObfuscate) {
        this.logger.info('Obfuscating generated code with APP_KEY as seed...')

        const appKey: Secret<string> | undefined = app.config.get('app.appKey')
        if (!appKey) {
          this.logger.error('Cannot obfuscate: APP_KEY is not defined.')
          return
        }

        const obfuscationResult = JavaScriptObfuscator.obfuscate(rawJavaScriptCode, {
          compact: true,
          controlFlowFlattening: true,
          controlFlowFlatteningThreshold: 0.75,
          deadCodeInjection: true,
          deadCodeInjectionThreshold: 0.4,
          debugProtection: false,
          disableConsoleOutput: false,
          identifierNamesGenerator: 'hexadecimal',
          log: false,
          numbersToExpressions: true,
          renameGlobals: false,
          selfDefending: true,
          shuffleStringArray: true,
          splitStrings: true,
          splitStringsChunkLength: 10,
          stringArray: true,
          stringArrayEncoding: ['base64'],
          stringArrayThreshold: 0.75,
          transformObjectKeys: true,
          unicodeEscapeSequence: false,
          seed: appKey.release(),
        })

        finalCode = obfuscationResult.getObfuscatedCode()
      }

      // --- 5. Write the Final Code to the File ---
      const finalPath = app.makePath(outputPath)
      await mkdir(dirname(finalPath), { recursive: true })
      await writeFile(finalPath, finalCode, 'utf-8')

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
