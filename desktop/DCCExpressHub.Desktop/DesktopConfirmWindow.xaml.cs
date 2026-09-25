using System.Windows;
using System.Windows.Input;

namespace DCCExpressHub.Desktop
{
    public enum DesktopConfirmResult
    {
        Cancel,
        Primary,
        Secondary
    }

    public partial class DesktopConfirmWindow : Window
    {
        public DesktopConfirmResult Result { get; private set; } =
            DesktopConfirmResult.Cancel;

        public DesktopConfirmWindow(
            Window owner,
            string title,
            string message,
            string primaryText,
            string cancelText,
            string? secondaryText = null)
        {
            InitializeComponent();

            Owner = owner;

            DialogTitleText.Text = title;
            DialogMessageText.Text = message;
            PrimaryButton.Content = primaryText;
            CancelButton.Content = cancelText;

            if (string.IsNullOrWhiteSpace(
                    secondaryText))
            {
                SecondaryButton.Visibility =
                    Visibility.Collapsed;
            }
            else
            {
                SecondaryButton.Content =
                    secondaryText;
                SecondaryButton.Visibility =
                    Visibility.Visible;
            }

            Loaded += (_, _) =>
            {
                FitToOwner();
                CancelButton.Focus();
            };

            owner.LocationChanged +=
                OwnerBoundsChanged;

            owner.SizeChanged +=
                OwnerBoundsChanged;

            Closed += (_, _) =>
            {
                owner.LocationChanged -=
                    OwnerBoundsChanged;

                owner.SizeChanged -=
                    OwnerBoundsChanged;
            };

            PreviewKeyDown +=
                DesktopConfirmWindow_PreviewKeyDown;
        }

        private void OwnerBoundsChanged(
            object? sender,
            EventArgs e)
        {
            FitToOwner();
        }

        private void FitToOwner()
        {
            if (Owner is null)
                return;

            Left = Owner.Left;
            Top = Owner.Top;
            Width = Math.Max(
                1,
                Owner.ActualWidth);
            Height = Math.Max(
                1,
                Owner.ActualHeight);
        }

        private void DesktopConfirmWindow_PreviewKeyDown(
            object sender,
            KeyEventArgs e)
        {
            if (e.Key != Key.Escape)
                return;

            Result =
                DesktopConfirmResult.Cancel;

            DialogResult = false;
            e.Handled = true;
        }

        private void PrimaryButton_Click(
            object sender,
            RoutedEventArgs e)
        {
            Result =
                DesktopConfirmResult.Primary;

            DialogResult = true;
        }

        private void SecondaryButton_Click(
            object sender,
            RoutedEventArgs e)
        {
            Result =
                DesktopConfirmResult.Secondary;

            DialogResult = true;
        }

        private void CancelButton_Click(
            object sender,
            RoutedEventArgs e)
        {
            Result =
                DesktopConfirmResult.Cancel;

            DialogResult = false;
        }
    }
}
