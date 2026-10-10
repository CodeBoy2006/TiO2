import { register } from 'tsx/esm/api'

// Consumer compiler settings must not change how the installed framework executes.
register({ tsconfig: false })
