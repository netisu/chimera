const chimeraConfig = {
  /**
   * The path where the generated routes file will be stored.
   * It should be a path relative to your project root.
   */
  outputPath: 'resources/js/chimera.ts',

  /**
   * Enable or disable route obfuscation.
   * When enabled, route names in the generated file will be hashed.
   */
  obfuscate: false,
};

export default chimeraConfig

declare module '@adonisjs/core/types' {
  export interface Config {
    chimera: typeof chimeraConfig
  }
}
