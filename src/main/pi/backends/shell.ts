/** Хелперы сборки WSL-команд. Порт `exec/WslShell.kt`. */

/** `\\wsl.localhost\<distro>\...` или `\\wsl$\<distro>\...` (слэши любые) → путь внутри WSL; иначе null. */
export function stripWslUncPrefix(path: string): string | null {
  const normalized = path.replace(/\\/g, '/')
  for (const prefix of ['//wsl.localhost/', '//wsl$/']) {
    if (normalized.toLowerCase().startsWith(prefix)) {
      const afterDistro = normalized.slice(prefix.length)
      const slash = afterDistro.indexOf('/')
      const rest = slash < 0 ? '' : afterDistro.slice(slash + 1)
      const result = '/' + rest
      return result === '//' ? '/' : result
    }
  }
  return null
}

/** UNC-путь WSL → distro + путь внутри дистрибутива; иначе null. */
export function parseWslUnc(path: string): { distro: string; wslPath: string } | null {
  const normalized = path.replace(/\\/g, '/')
  for (const prefix of ['//wsl.localhost/', '//wsl$/']) {
    if (normalized.toLowerCase().startsWith(prefix)) {
      const afterDistro = normalized.slice(prefix.length)
      const slash = afterDistro.indexOf('/')
      if (slash < 0) return null
      return { distro: afterDistro.slice(0, slash), wslPath: afterDistro.slice(slash) }
    }
  }
  return null
}

/** Обратно к stripWslUncPrefix: WSL-путь → UNC со слэшами `/`. */
export function buildWslUncPath(distro: string, wslPath: string): string {
  return `//wsl.localhost/${distro}/${wslPath.replace(/^\//, '')}`
}

/** Экранирование одного аргумента для одинарных кавычек bash: it's -> 'it'\''s' */
export function shellQuote(arg: string): string {
  return `'${arg.replace(/'/g, "'\\''")}'`
}

/** Команда для bash -lic: исполняемый файл + аргументы, каждый в одинарных кавычках. */
export function buildBashCommand(executable: string, args: string[]): string {
  return [executable, ...args].map(shellQuote).join(' ')
}

/** Аргументы спавна: `wsl.exe -d <distro> [--cd <wslCwd>] --exec bash -lic '<bashCommand>'`.
 *  -l -i обязательны: без них не грузится nvm и pi не находится. */
export function buildWslSpawnArgs(distro: string, wslCwd: string | null, bashCommand: string): string[] {
  return [
    '-d',
    distro,
    ...(wslCwd !== null ? ['--cd', wslCwd] : []),
    '--exec',
    'bash',
    '-lic',
    bashCommand
  ]
}

/** Кавычки для аргумента cmd.exe: путь/аргумент целиком в двойных кавычках. */
export function quoteWindowsArg(arg: string): string {
  return `"${arg.replace(/"/g, '""')}"`
}
