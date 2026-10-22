import { ButtonLink } from "@browser-client/ui/components/button-link"
import { Card, CardContent, CardHeader } from "@browser-client/ui/components/card"
import { repositoryUrl } from "@browser-client/ui/components/repository-link"
import { SiteHeader } from "@/components/site-header"

const features = [
  {
    number: "01",
    title: "Every screen, considered",
    description: "A flexible layout that feels at home on your phone, tablet, and desktop.",
  },
  {
    number: "02",
    title: "A consistent foundation",
    description: "Shared components keep the web, admin, and extension experiences connected.",
  },
  {
    number: "03",
    title: "Light, dark, or yours",
    description: "Choose a theme you like, or let the page follow your system preference.",
  },
]

export default function Home() {
  return (
    <div className="flex min-h-svh flex-col">
      <a
        href="#main-content"
        className="sr-only z-50 rounded-lg bg-background p-3 focus:not-sr-only focus:fixed focus:top-2 focus:left-2"
      >
        Skip to content
      </a>
      <SiteHeader />
      <main id="main-content" className="flex-1" tabIndex={-1}>
        <section
          id="overview"
          aria-labelledby="web-title"
          className="mx-auto max-w-6xl scroll-mt-6 px-4 py-20 sm:px-6 sm:py-28 lg:py-36"
        >
          <div className="max-w-3xl">
            <p className="mb-6 inline-flex rounded-full border px-3 py-1 text-xs font-medium text-muted-foreground">
              A place to begin
            </p>
            <h1 id="web-title" className="text-5xl font-semibold tracking-tight sm:text-6xl lg:text-7xl">
              Welcome
            </h1>
            <p className="mt-6 max-w-xl text-xl leading-relaxed text-muted-foreground sm:text-2xl">
              A simple foundation for your next idea.
            </p>
            <p className="mt-4 max-w-lg text-sm leading-7 text-muted-foreground sm:text-base">
              Start with a clear layout, familiar components, and the space to make something of your own.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <ButtonLink href="#features" size="lg">
                Explore features <span aria-hidden="true">↗</span>
              </ButtonLink>
              <ButtonLink
                href={`${repositoryUrl}#readme`}
                target="_blank"
                rel="noopener noreferrer"
                variant="outline"
                size="lg"
              >
                Read the docs <span className="sr-only">(opens in a new tab)</span>
              </ButtonLink>
            </div>
          </div>
        </section>
        <section id="features" aria-labelledby="features-title" className="scroll-mt-6 border-y bg-muted/30">
          <div className="mx-auto max-w-6xl px-4 py-14 sm:px-6 sm:py-20">
            <h2 id="features-title" className="text-2xl font-semibold tracking-tight sm:text-3xl">
              Thoughtful defaults. Room to grow.
            </h2>
            <p className="mt-3 max-w-xl text-sm leading-7 text-muted-foreground">
              The essentials are here. What comes next is up to you.
            </p>
            <div className="mt-8 grid gap-4 md:grid-cols-3">
              {features.map(({ number, title, description }) => (
                <Card key={number} className="gap-5 py-6">
                  <CardHeader className="gap-4 px-6">
                    <span className="text-xs font-medium text-muted-foreground" aria-hidden="true">
                      {number}
                    </span>
                    <h3 className="text-base font-medium">{title}</h3>
                  </CardHeader>
                  <CardContent className="px-6 text-sm leading-7 text-muted-foreground">{description}</CardContent>
                </Card>
              ))}
            </div>
          </div>
        </section>
        <section
          id="resources"
          aria-labelledby="resources-title"
          className="mx-auto flex max-w-6xl scroll-mt-6 flex-col items-start justify-between gap-6 px-4 py-14 sm:px-6 sm:py-20 md:flex-row md:items-center"
        >
          <div className="max-w-lg">
            <h2 id="resources-title" className="text-2xl font-semibold tracking-tight">
              Make this starting point your own.
            </h2>
            <p className="mt-3 text-sm leading-7 text-muted-foreground">
              Find setup instructions and project details in the documentation, then start building your experience.
            </p>
          </div>
          <ButtonLink href={`${repositoryUrl}#readme`} target="_blank" rel="noopener noreferrer" variant="outline" size="lg">
            Project documentation <span aria-hidden="true">↗</span>
            <span className="sr-only">(opens in a new tab)</span>
          </ButtonLink>
        </section>
      </main>
      <footer className="border-t">
        <div className="mx-auto flex max-w-6xl flex-col gap-2 px-4 py-6 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <span className="font-medium text-foreground">Browser Client</span>
          <span>Web, admin, and extension. One shared foundation.</span>
        </div>
      </footer>
    </div>
  )
}
