import { useTheme } from "next-themes"
import { Toaster as Sonner, toast } from "sonner"
import "../../../styles/components/ui/sonner.css"

type ToasterProps = React.ComponentProps<typeof Sonner>

const Toaster = ({ ...props }: ToasterProps) => {
  const { theme = "system" } = useTheme()

  return (
    <Sonner
      theme={theme as ToasterProps["theme"]}
      className="toaster group"
      toastOptions={{
        classNames: {
          toast: "toast",
          description: "description",
          actionButton: "actionButton",
          cancelButton: "cancelButton",
        },
      }}
      {...props}
    />
  )
}

export { Toaster, toast }
