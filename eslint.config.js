import js from '@eslint/js'
import tsPlugin from '@typescript-eslint/eslint-plugin'
import tsParser from '@typescript-eslint/parser'
import prettier from 'eslint-config-prettier'
import vue from 'eslint-plugin-vue'
import globals from 'globals'
import vueParser from 'vue-eslint-parser'

const sourceFiles = ['**/*.{js,mjs,cjs,ts,mts,vue}']
const typedFiles = ['**/*.{ts,mts,vue}']

export default [
    {
        ignores: [
            '.vitepress/cache/**',
            '.vitepress/dist/**',
            '.vitepress/tmp/**',
            '**/.tio2-tmp/**',
            'apps/cms-web/dist/**',
            'node_modules/**',
            'tmp/**'
        ]
    },
    js.configs.recommended,
    ...vue.configs['flat/essential'],
    {
        files: sourceFiles,
        languageOptions: {
            ecmaVersion: 'latest',
            sourceType: 'module',
            globals: {
                ...globals.browser,
                ...globals.es2021,
                ...globals.node
            }
        },
        rules: {
            'vue/multi-word-component-names': 'off'
        }
    },
    {
        files: typedFiles,
        languageOptions: {
            parser: tsParser,
            parserOptions: {
                ecmaVersion: 'latest',
                sourceType: 'module'
            }
        },
        plugins: {
            '@typescript-eslint': tsPlugin
        },
        rules: {
            ...tsPlugin.configs.recommended.rules,
            'no-undef': 'off',
            'no-unused-vars': 'off',
            '@typescript-eslint/no-explicit-any': 'off',
            '@typescript-eslint/no-unused-vars': [
                'error',
                {
                    argsIgnorePattern: '^_',
                    caughtErrorsIgnorePattern: '^_',
                    varsIgnorePattern: '^_'
                }
            ]
        }
    },
    {
        files: ['**/*.vue'],
        languageOptions: {
            parser: vueParser,
            parserOptions: {
                ecmaVersion: 'latest',
                extraFileExtensions: ['.vue'],
                parser: tsParser,
                sourceType: 'module'
            }
        }
    },
    prettier
]
