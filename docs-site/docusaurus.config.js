// @ts-check
// `@type` JSDoc annotations allow editor autocompletion and type checking
// (when paired with `@ts-check`).
// There are various equivalent ways to declare your Docusaurus config.
// See: https://docusaurus.io/docs/api/docusaurus-config

import {themes as prismThemes} from 'prism-react-renderer';

// This runs in Node.js - Don't use client-side code here (browser APIs, JSX...)

/** @type {import('@docusaurus/types').Config} */
const config = {
  title: 'Kickstat',
  tagline: 'Documentation for the Kickstat sport coaching platform',
  favicon: 'img/favicon.ico',

  // Future flags, see https://docusaurus.io/docs/api/docusaurus-config#future
  future: {
    v4: true, // Improve compatibility with the upcoming Docusaurus v4
  },

  // TODO: set this once a deployment target is chosen (GitHub Pages /
  // Cloudflare Pages / other static host). This MUST match the real
  // deployed URL or client-side routing will break.
  url: 'https://kickstat-docs-v2.netlify.app',
  // '/' if deployed at the domain root, '/<repo-name>/' if deployed under
  // a subpath (e.g. the default for GitHub Pages project sites).
  baseUrl: '/',

  // Only relevant if you deploy via `npm run deploy` (the gh-pages package)
  // to an actual github.com-hosted mirror of this repo. Since the primary
  // repo here is self-hosted on Gitea, this project may instead deploy via
  // Cloudflare Pages (or a manual static upload) — in which case these two
  // fields and the `deploymentBranch` below are unused.
  organizationName: 'bug-off',
  projectName: 'sport-coaching-tool',

  onBrokenLinks: 'throw',

  markdown: {
    mermaid: true,
  },
  themes: ['@docusaurus/theme-mermaid'],

  plugins: [
    [
      require.resolve('@easyops-cn/docusaurus-search-local'),
      {
        hashed: true,
        indexBlog: false,
        docsDir: 'docs',
        docsRouteBasePath: '/',
      },
    ],
  ],

  // Even if you don't use internationalization, you can use this field to set
  // useful metadata like html lang. For example, if your site is Chinese, you
  // may want to replace "en" with "zh-Hans".
  i18n: {
    defaultLocale: 'en',
    locales: ['en'],
  },

  presets: [
    [
      'classic',
      /** @type {import('@docusaurus/preset-classic').Options} */
      ({
        docs: {
          routeBasePath: '/',
          sidebarPath: './sidebars.js',
          // Gitea's edit-in-place URL pattern (adjust the branch name and
          // the docs-site subfolder path if either differs in your repo).
          editUrl:
            'https://sdp.ms.wits.ac.za/bug-off/sport-coaching-tool/_edit/main/docs-site/',
        },
        blog: false,
        theme: {
          customCss: './src/css/custom.css',
        },
      }),
    ],
  ],

  themeConfig:
    /** @type {import('@docusaurus/preset-classic').ThemeConfig} */
    ({
      // Replace with your project's social card
      image: 'img/docusaurus-social-card.jpg',
      colorMode: {
        respectPrefersColorScheme: true,
      },
      navbar: {
        title: 'Kickstat',
        logo: {
          // TODO: replace with a real logo in static/img/ once the team has one.
          alt: 'Kickstat Logo',
          src: 'img/logo.svg',
        },
        items: [
          {
            type: 'docSidebar',
            sidebarId: 'tutorialSidebar',
            position: 'left',
            label: 'Docs',
          },
          {
            href: 'https://sdp.ms.wits.ac.za/bug-off/sport-coaching-tool',
            label: 'Repository',
            position: 'right',
          },
        ],
      },
      footer: {
        style: 'dark',
        links: [
          {
            title: 'Docs',
            items: [
              {label: 'Overview', to: '/'},
              {label: 'Product', to: '/product/overview'},
              {label: 'Getting Started', to: '/getting-started/backend'},
              {label: 'Architecture', to: '/architecture/overview'},
            ],
          },
          {
            title: 'Planning',
            items: [
              {label: 'Project Plan', to: '/planning/project-plan'},
              {label: 'Sprint Backlogs', to: '/planning/sprint-backlogs'},
              {label: 'Meetings', to: '/meetings/overview'},
            ],
          },
          {
            title: 'Project',
            items: [
              {
                label: 'Repository',
                href: 'https://sdp.ms.wits.ac.za/bug-off/sport-coaching-tool',
              },
            ],
          },
        ],
        copyright: `Copyright © ${new Date().getFullYear()} Kickstat. Built with Docusaurus.`,
      },
      prism: {
        theme: prismThemes.github,
        darkTheme: prismThemes.dracula,
      },
    }),
};

export default config;
