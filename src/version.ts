declare const __PACKAGE_VERSION__: string

export function packageVersion(): string {
  return typeof __PACKAGE_VERSION__ === 'string' ? __PACKAGE_VERSION__ : '0.2.0'
}
