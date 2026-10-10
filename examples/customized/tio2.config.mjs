export default {
    site: { title: 'Workshop Notes', url: 'https://workshop.example', author: 'A maker' },
    content: { postsDir: 'writing', topicsDir: 'collections', foundationsDir: 'knowledge', pagesDir: 'info' },
    theme: {
        nav: [
            { text: 'About', link: '/info/about' },
            { text: 'Knowledge', link: '/info/foundations' }
        ],
        clientEntry: 'theme/client.ts',
        layout: 'theme/layout.mjs',
        pages: { 'info/about.md': 'theme/about.mjs' }
    },
    foundations: {
        groups: [
            {
                id: 'practice',
                title: 'Practice',
                englishTitle: 'Practice',
                description: 'Ideas used in the workshop.',
                domains: [
                    { id: 'practice/basics', group: 'practice', title: 'Basics', description: 'Starting points.' }
                ]
            }
        ],
        routes: [
            {
                id: 'inquiry',
                title: 'From observation to hypothesis',
                audience: 'New readers',
                promise: 'Separate what was noticed from a proposed explanation.',
                type: 'core',
                entries: ['observation', 'hypothesis'],
                capstoneHref: '/knowledge/hypothesis.html#formal-statement'
            }
        ]
    },
    integrations: { feed: false, sitemap: false }
}
