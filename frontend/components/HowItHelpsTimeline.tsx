type TimelineStep = {
  title: string;
  description: string;
};

const steps: TimelineStep[] = [
  {
    title: "Detect issues automatically",
    description: "Finds missing values, invalid formats, duplicates",
  },
  {
    title: "Show exactly what’s wrong",
    description: "Highlights rows and sample values so you see the problem clearly",
  },
  {
    title: "Suggest smart fixes",
    description: "Recommends what to do instead of making you figure it out",
  },
  {
    title: "Let you stay in control",
    description: "You choose which fixes to apply, nothing is forced",
  },
  {
    title: "Clean only what matters",
    description: "Drop unnecessary columns before export",
  },
  {
    title: "Export ready-to-use data",
    description: "Get a cleaned CSV for analysis or downstream use",
  },
];

export default function HowItHelpsTimeline() {
  return (
    <section className="tile info-tile info-tile-wide help-timeline">
      <div className="help-timeline-header">
        <h2>How this helps</h2>
        <p className="help-timeline-intro">
          Turns messy data into a guided cleanup workflow. Saves time, reduces
          manual errors, and makes every cleaning decision transparent.
        </p>
      </div>

      <div className="help-timeline-list">
        {steps.map((step, index) => {
          const isLast = index === steps.length - 1;
          const isPrimary = index % 2 === 0;

          return (
            <article
              key={step.title}
              className={`help-timeline-step ${isPrimary ? "primary" : "secondary"}`}
            >
              <div className="help-timeline-rail">
                {!isLast && (
                  <span aria-hidden="true" className="help-timeline-line" />
                )}
                <span aria-hidden="true" className="help-timeline-dot" />
              </div>

              <div className="help-timeline-card">
                <h3>{step.title}</h3>
                <p>{step.description}</p>
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}
