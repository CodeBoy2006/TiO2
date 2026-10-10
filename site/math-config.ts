export const markdownMathOptions = {
    tex: {
        tags: 'ams',
        packages: [
            'base',
            'ams',
            'newcommand',
            'configmacros',
            'mathtools',
            'cases',
            'empheq',
            'physics',
            'mhchem',
            'color',
            'colorv2',
            'boldsymbol',
            'cancel',
            'enclose',
            'action',
            'html',
            'bbox',
            'unicode'
        ],
        macros: {
            bm: ['\\boldsymbol{#1}', 1],
            BigO: '\\mathcal{O}',
            BigOmega: '\\Omega',
            BigTheta: '\\Theta',
            littleo: 'o',
            littleomega: '\\omega',
            Pr: '\\text{Pr}',
            E: '\\mathbb{E}',
            Var: '\\text{Var}',
            Cov: '\\text{Cov}',
            N: '\\mathbb{N}',
            Z: '\\mathbb{Z}',
            Q: '\\mathbb{Q}',
            R: '\\mathbb{R}',
            C: '\\mathbb{C}',
            argmin: '\\operatorname{argmin}',
            argmax: '\\operatorname{argmax}',
            poly: '\\text{poly}',
            polylog: '\\text{polylog}',
            // MathJax 3 has no stmaryrd package, so compose these from built-in glyphs.
            llbracket: '\\mathopen{[\\![}',
            rrbracket: '\\mathclose{]\\!]}'
        }
    }
}
