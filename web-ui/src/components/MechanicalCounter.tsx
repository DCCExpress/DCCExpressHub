import type { CSSProperties } from "react";

import "./MechanicalCounter.css";

type MechanicalCounterProps = {
  value: number;
  digits?: number;
  decimals?: number;
  digitHeight?: number;
  unit?: string;
  label?: string;
  accentFraction?: boolean;
  animate?: boolean;
  className?: string;
};

function clampInteger(
  value: number,
  min: number,
  max: number
): number {
  return Math.max(
    min,
    Math.min(
      max,
      Math.round(
        value
      )
    )
  );
}

function decimalSeparator(): string {
  try {
    return (
      Intl.NumberFormat()
        .formatToParts(
          1.1
        )
        .find(
          part =>
            part.type ===
            "decimal"
        )
        ?.value ??
      "."
    );
  } catch {
    return ".";
  }
}

function normalizeCounterDigits(
  value: number,
  integerDigits: number,
  decimals: number
): string {
  const safeValue =
    Number.isFinite(
      value
    )
      ? Math.max(
          0,
          value
        )
      : 0;

  const scale =
    10 **
    decimals;

  const totalDigits =
    integerDigits +
    decimals;

  const modulus =
    10 **
    totalDigits;

  const scaled =
    Math.floor(
      safeValue *
        scale +
        1e-9
    ) %
    modulus;

  return String(
    scaled
  ).padStart(
    totalDigits,
    "0"
  );
}

function MechanicalDigit({
  digit,
  accent,
  animate,
}: {
  digit: string;
  accent: boolean;
  animate: boolean;
}) {
  const numeric =
    clampInteger(
      Number(
        digit
      ),
      0,
      9
    );

  return (
    <span
      className={
        "mechanical-counter__digit" +
        (
          accent
            ? " mechanical-counter__digit--accent"
            : ""
        )
      }
      aria-hidden="true"
    >
      <span
        className={
          "mechanical-counter__drum" +
          (
            animate
              ? " mechanical-counter__drum--animated"
              : ""
          )
        }
        style={{
          transform:
            `translateY(-${numeric * 10}%)`,
        }}
      >
        {Array.from(
          {
            length: 10,
          },
          (
            _,
            index
          ) => (
            <span
              key={
                index
              }
              className="mechanical-counter__drum-value"
            >
              {index}
            </span>
          )
        )}
      </span>
    </span>
  );
}

export default function MechanicalCounter({
  value,
  digits = 6,
  decimals = 1,
  digitHeight = 28,
  unit,
  label,
  accentFraction = true,
  animate = true,
  className,
}: MechanicalCounterProps) {
  const safeDigits =
    clampInteger(
      digits,
      1,
      10
    );

  const safeDecimals =
    clampInteger(
      decimals,
      0,
      3
    );

  const safeHeight =
    clampInteger(
      digitHeight,
      18,
      64
    );

  const rawDigits =
    normalizeCounterDigits(
      value,
      safeDigits,
      safeDecimals
    );

  const parts =
    rawDigits.split(
      ""
    );

  const readableValue =
    (
      Number.isFinite(
        value
      )
        ? Math.max(
            0,
            value
          )
        : 0
    ).toFixed(
      safeDecimals
    );

  const style = {
    "--mechanical-counter-digit-height":
      `${safeHeight}px`,
  } as CSSProperties;

  return (
    <div
      className={
        [
          "mechanical-counter",
          className,
        ]
          .filter(
            Boolean
          )
          .join(
            " "
          )
      }
      style={style}
      role="group"
      aria-label={
        [
          label,
          readableValue,
          unit,
        ]
          .filter(
            Boolean
          )
          .join(
            " "
          )
      }
    >
      {label && (
        <span className="mechanical-counter__label">
          {label}
        </span>
      )}

      <span className="mechanical-counter__housing">
        <span className="mechanical-counter__digits">
          {parts.map(
            (
              digit,
              index
            ) => {
              const fractionStart =
                safeDigits;

              const isFraction =
                index >=
                fractionStart;

              const separatorBefore =
                safeDecimals >
                  0 &&
                index ===
                  fractionStart;

              return (
                <span
                  key={
                    index
                  }
                  className="mechanical-counter__cell"
                >
                  {separatorBefore && (
                    <span
                      className="mechanical-counter__separator"
                      aria-hidden="true"
                    >
                      {decimalSeparator()}
                    </span>
                  )}

                  <MechanicalDigit
                    digit={
                      digit
                    }
                    accent={
                      accentFraction &&
                      isFraction
                    }
                    animate={
                      animate
                    }
                  />
                </span>
              );
            }
          )}
        </span>

        {unit && (
          <span className="mechanical-counter__unit">
            {unit}
          </span>
        )}
      </span>
    </div>
  );
}
